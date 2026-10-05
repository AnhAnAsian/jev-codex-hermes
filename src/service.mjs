import http from 'node:http';
import fs from 'node:fs';
import https from 'node:https';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import WebSocket,{WebSocketServer} from 'ws';
import {readConfig,loadKey,safeLog,loadModelCatalog,payloadLimit} from './settings.mjs';
import {RoutingEngine} from './routing.mjs';
import {SettingsStore} from './settings-store.mjs';
import {classificationMetadata} from './ui-metadata.mjs';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

function allowed(req) {
  if(req.socket.remoteAddress!=='127.0.0.1')return false;
  const host=req.headers.host?.split(':')[0];
  if(host!=='127.0.0.1' && host!=='localhost')return false;
  if(req.headers.origin) {
    try {if(new URL(req.headers.origin).origin!==`http://${req.headers.host}`)return false;}catch{return false;}
  }
  return true;
}
function routePath(url,config) {
  const parsed=new URL(url,'http://127.0.0.1');
  const match=/^\/(codex|claude|hermes\/codex|hermes\/claude)(\/.*|$)/.exec(parsed.pathname);
  if(!match)throw new Error('unknown_route');
  const provider=match[1].split('/').at(-1),client=match[1].startsWith('hermes/')?'hermes':provider;
  return {provider,client,target:new URL(config.providers[provider].upstream.replace(/\/$/,'')+(match[2]||'/')+parsed.search)};
}
function forwardHeaders(source,target,ws=false) {
  const headers={...source,host:target.host};
  for(const k of ['content-length','connection','transfer-encoding','keep-alive','proxy-connection','upgrade','accept-encoding'])delete headers[k];
  if(ws)for(const k of Object.keys(headers))if(k.startsWith('sec-websocket-'))delete headers[k];
  headers['accept-encoding']='identity';
  return headers;
}
export function servedInspector(receipt,transport,logger) {
  let buffer='',done=false;
  const inspect=line=>{
    try {
      const event=JSON.parse(line.startsWith('data:')?line.slice(5).trim():line);
      // Read protocol metadata only; never infer a model from generated content.
      const model=event.response?.model || (event.type==='message_start'?event.message?.model:!event.type?event.model:null);
      if(typeof model==='string' && /^[a-zA-Z0-9._\-:\[\]]{1,120}$/.test(model)) {
        done=true;logger({...receipt,transport,state:'served',served_model:model});
      }
    }catch{}
  };
  return chunk=>{
    if(done)return;
    buffer+=chunk.toString('utf8');
    for(let end;(end=buffer.indexOf('\n'))>=0 && !done;) {
      inspect(buffer.slice(0,end));buffer=buffer.slice(end+1);
    }
    if(!done)inspect(buffer); // complete non-streamed JSON / WebSocket frame
    if(done || buffer.length>262144)buffer='';
  };
}
export async function startService({config=readConfig,classifier,logger=safeLog,port,catalog=loadModelCatalog,settingsStore=new SettingsStore({catalog})}={}) {
  let snapshot=structuredClone(config()),degraded=false;
  const initial=snapshot;
  // One startup limit covers HTTP bodies, WebSocket frames and queued frames.
  const maxPayloadBytes=payloadLimit(initial);
  const current=()=>{try{snapshot=structuredClone(config());degraded=false;}catch{degraded=true;}return snapshot;};
  const engine=new RoutingEngine({config:current,classifier,logger});
  const refreshModels=()=>engine.seedModels(catalog());refreshModels();
  const settingsToken=randomUUID();
  const handler=async(req,res)=>{
    if(!allowed(req))return res.writeHead(403).end();
    if(req.method==='GET' && req.url==='/favicon.ico')return res.writeHead(204).end();
    const assets={'/':['index.html','text/html; charset=utf-8'],'/advice.js':['advice.js','text/javascript; charset=utf-8'],'/advice.css':['advice.css','text/css; charset=utf-8'],
      '/settings':['settings.html','text/html; charset=utf-8'],'/settings.js':['settings.js','text/javascript; charset=utf-8'],'/settings-controls.js':['settings-controls.js','text/javascript; charset=utf-8'],'/settings.css':['settings.css','text/css; charset=utf-8'],
      '/shared.css':['shared.css','text/css; charset=utf-8'],'/status.js':['status.js','text/javascript; charset=utf-8']};
    if(req.method==='GET' && assets[req.url]) {
      const [file,type]=assets[req.url];
      return res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
        'referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        .end(fs.readFileSync(new URL('../ui/'+file,import.meta.url)));
    }
    if(req.url==='/settings/state') {
      res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
      res.setHeader('content-type','application/json');
      if(req.method==='GET') {
        try{return res.end(JSON.stringify({...settingsStore.read(),token:settingsToken}));}
        catch{return res.writeHead(503).end('{"error":"Configuration is invalid or unavailable. Repair config.json, then reload."}');}
      }
      if(req.method!=='POST')return res.writeHead(405,{'allow':'GET, POST'}).end('{}');
      if(req.headers.origin!==`http://${req.headers.host}` || req.headers['x-jev-settings-token']!==settingsToken)return res.writeHead(403).end('{"error":"Reload settings before saving."}');
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return res.writeHead(415).end('{}');
      try {
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>32768)return res.writeHead(413).end('{"error":"Settings payload too large."}');chunks.push(chunk);}
        const saved=settingsStore.save(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        let refreshRequired=false;
        try {current();refreshModels();refreshRequired=degraded;}catch {refreshRequired=true;}
        return res.end(JSON.stringify({...saved,token:settingsToken,saved:true,refreshRequired}));
      }catch(error) {
        const status=error.status===409?409:error.status===400 || error instanceof SyntaxError?400:500;
        const message=status===409?'Settings changed elsewhere. Reload and apply your changes again.':status===400?'Invalid settings. Check model IDs, reasoning levels and classification limit.':'Save status could not be confirmed. Reload settings to check before retrying.';
        return res.writeHead(status).end(JSON.stringify({error:message}));
      }
    }
    if(req.url==='/advice' && req.method==='POST') {
      res.setHeader('cache-control','no-store');
      if(!req.headers['content-type']?.startsWith('application/json'))return res.writeHead(415).end();
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return res.writeHead(403).end();
      try {
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>131072)return res.writeHead(413).end();chunks.push(chunk);}
        const input=JSON.parse(Buffer.concat(chunks).toString());
        if(typeof input.prompt!=='string' || !input.prompt.trim() || input.prompt.length>30000 || !['codex','claude'].includes(input.provider))return res.writeHead(400,{'content-type':'application/json'}).end('{"error":"Enter a task and choose a supported client."}');
        const result=await engine.advice({prompt:input.prompt,provider:input.provider,disclosure:input.disclosure});
        return res.writeHead(result.metadataChanged?409:result.advice?200:503,{'content-type':'application/json'}).end(JSON.stringify(result));
      }catch{return res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Advice unavailable. Keep your current model and try again."}');}
    }
    if(req.url==='/health') {
      const c=current();refreshModels();
      return res.writeHead(degraded?503:200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({ok:!degraded,service:'jev-desktop-hermes',version,config_state:degraded?'last-valid':'valid',enabled:c.enabled,keyAvailable:Boolean(loadKey(c)),...classificationMetadata(c),host:'127.0.0.1',port:server.address().port,maxPayloadBytes}));
    }
    if(req.url==='/desktop/decision' && req.method==='POST') {
      try {
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>65536)return res.writeHead(413).end();chunks.push(chunk);}
        const input=JSON.parse(Buffer.concat(chunks).toString());
        const decision=await engine.desktopDecision(input);
        return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({decision}));
      }catch{return res.writeHead(200,{'content-type':'application/json'}).end('{"decision":null}');}
    }
    if(req.method==='HEAD' && /^\/claude\/?$/.test(req.url))return res.writeHead(200).end();
    let r;
    try {r=routePath(req.url,current());}catch{return res.writeHead(404).end();}
    let receipt={client:r.client,request_id:randomUUID(),state:'passthrough'};
    const rejectPayload=bytes=>{
      logger({...receipt,state:'payload-too-large',transport:'http',status:413,payload_bytes:bytes,limit_bytes:maxPayloadBytes});
      // Drain without retaining unread data so chunked requests get the JSON error.
      req.resume();
      return res.writeHead(413,{'content-type':'application/json','connection':'close'}).end(JSON.stringify({error:{
        type:'proxy_error',code:'payload_too_large',
        message:`Jev proxy request exceeds its ${maxPayloadBytes/1024/1024} MiB limit. Compact the conversation, or increase maxPayloadBytes in the router config and restart the service.`,
        payload_bytes:bytes,limit_bytes:maxPayloadBytes
      }}));
    };
    try {
      const declaredSize=Number(req.headers['content-length']);
      if(Number.isFinite(declaredSize) && declaredSize>maxPayloadBytes)return rejectPayload(declaredSize);
      const chunks=[];let size=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        size+=chunk.length;if(size>maxPayloadBytes)return rejectPayload(size);chunks.push(chunk);
      }
      let out=Buffer.concat(chunks);chunks.length=0;
      const sampling=req.method==='POST' && /\/(responses|messages)$/.test(r.target.pathname);
      if(sampling) {
        try {
          const body=JSON.parse(out.toString());
          const rewritten=await engine.rewrite(body,r.provider,r.client,req.headers);
          receipt=rewritten.receipt;
          // Native Codex selections are untouched; preserve bytes and avoid a copy.
          if(r.provider!=='codex' || receipt.state!=='manual')out=Buffer.from(JSON.stringify(rewritten.body));
        }catch {logger({...receipt,state:'parse-fallback'});}
      }
      if(out.length>maxPayloadBytes)return rejectPayload(out.length);
      const upstream=(r.target.protocol==='http:'?http:https).request(r.target,{method:req.method,headers:forwardHeaders(req.headers,r.target)},up=>{
        const headers={...up.headers};delete headers['content-length'];
        if(req.method==='GET' && /\/models$/.test(r.target.pathname) && r.provider==='codex' && up.statusCode===200) {
          const chunks=[];up.on('data',x=>chunks.push(x));up.on('end',()=>{
            let data=Buffer.concat(chunks);
            try {data=Buffer.from(JSON.stringify(engine.catalog(JSON.parse(data.toString()))));}catch{}
            res.writeHead(up.statusCode,headers);res.end(data);
          });
        } else {
          res.writeHead(up.statusCode,headers);
          if(sampling) {
            logger({...receipt,status:up.statusCode,transport:'http',state:'upstream-response'});
            up.on('data',servedInspector(receipt,'http',logger));
          }
          up.pipe(res);
        }
        up.on('error',()=>res.destroy());
      });
      const abort=()=>upstream.destroy();res.on('close',()=>{if(!res.writableFinished)abort();});
      upstream.setTimeout(300000,()=>upstream.destroy());
      upstream.on('error',()=>{
        logger({...receipt,state:'upstream-error'});
        if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});
        if(!res.writableEnded)res.end('{"error":{"type":"proxy_error","message":"Upstream connection unavailable"}}');
      });
      upstream.end(out);
    }catch {if(!res.headersSent)res.writeHead(502);res.end();}
  };
  const server=http.createServer((req,res)=>{
    handler(req,res).catch(()=>{
      logger({state:'request-error'});
      if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});
      if(!res.writableEnded)res.end('{"error":"Router temporarily unavailable"}');
    });
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:maxPayloadBytes});
  server.on('upgrade',(req,socket,head)=>{
    if(!allowed(req))return socket.destroy();
    let r;try{r=routePath(req.url,current());}catch{return socket.destroy();}
    if(r.provider!=='codex')return socket.destroy();
    wss.handleUpgrade(req,socket,head,down=>{
      const target=new URL(r.target);target.protocol=target.protocol==='https:'?'wss:':'ws:';
      const up=new WebSocket(target,{headers:forwardHeaders(req.headers,r.target,true),handshakeTimeout:15000,maxPayload:maxPayloadBytes});
      const connectionKey=randomUUID();let receipt={client:r.client,request_id:connectionKey,state:'websocket'},queue=Promise.resolve();
      let inspect=servedInspector(receipt,'websocket',logger);
      let opened=once(up,'open');opened.catch(()=>{});
      let pendingBytes=0,pendingMessages=0;
      const rejectPayload=bytes=>{
        logger({...receipt,state:'payload-too-large',transport:'websocket',payload_bytes:bytes,limit_bytes:maxPayloadBytes});
        down.close(1009,'Jev proxy payload/queue limit exceeded');up.terminate();
      };
      down.on('message',(data,binary)=>{
        if(pendingMessages>=64 || pendingBytes+data.length>maxPayloadBytes){rejectPayload(pendingBytes+data.length);return;}
        pendingBytes+=data.length;pendingMessages++;
        queue=queue.then(async()=>{
          let out=data;
          if(!binary)try{
            const body=JSON.parse(data.toString());
            if(body.type==='response.create') {
              const result=await engine.rewrite(body,r.provider,r.client,req.headers,connectionKey);
              receipt=result.receipt;inspect=servedInspector(receipt,'websocket',logger);
              if(receipt.state!=='manual')out=JSON.stringify(result.body);
            }
          }catch{logger({...receipt,state:'ws-parse-fallback'});}
          const bytes=typeof out==='string'?Buffer.byteLength(out):out.length;
          if(bytes>maxPayloadBytes){rejectPayload(bytes);return;}
          await opened;
          if(up.readyState===WebSocket.OPEN)up.send(out,{binary});
        }).catch(()=>{logger({...receipt,state:'ws-upstream-error'});down.close(1011,'Upstream unavailable');}).finally(()=>{pendingBytes-=data.length;pendingMessages--;});
      });
      up.on('message',(data,binary)=>{
        if(!binary)inspect(data);
        if(down.readyState===WebSocket.OPEN)down.send(data,{binary});
      });
      for(const [from,to] of [[up,down],[down,up]]) {
        from.on('close',(code)=>{
          if(to.readyState===WebSocket.OPEN)to.close(code===1000 || code===1009?code:1011);
          else if(to.readyState===WebSocket.CONNECTING)to.terminate();
          // A peer already closing must finish its handshake, especially for 1009.
        });
        from.on('error',error=>{
          if(error.code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
            logger({...receipt,state:'payload-too-large',transport:'websocket',limit_bytes:maxPayloadBytes});
            if(to.readyState===WebSocket.OPEN)to.close(1009,'Jev proxy payload limit exceeded');
            else if(to.readyState===WebSocket.CONNECTING)to.terminate();
          } else {
            logger({...receipt,state:'ws-transport-error'});
            if(to.readyState!==WebSocket.CLOSING && to.readyState!==WebSocket.CLOSED)to.terminate();
          }
        });
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port??initial.port,'127.0.0.1',resolve);});
  return {server,engine,port:server.address().port,close:async()=>{for(const c of wss.clients)c.terminate();await new Promise(r=>server.close(r));}};
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  try {
    const service=await startService();safeLog({state:'service-started'});
    process.on('SIGTERM',async()=>{await service.close();process.exit(0);});
    process.on('SIGINT',async()=>{await service.close();process.exit(0);});
  }catch {safeLog({state:'service-start-failed'});process.exit(1);}
}
