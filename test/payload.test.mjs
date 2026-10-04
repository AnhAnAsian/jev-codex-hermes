import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import WebSocket,{WebSocketServer} from 'ws';
import {startService} from '../src/service.mjs';
import {DEFAULT_MAX_PAYLOAD_BYTES,payloadLimit,validateConfig} from '../src/settings.mjs';

const base=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
const MiB=1024*1024;
const digest=data=>createHash('sha256').update(data).digest('hex');
const imageTask=model=>({model,reasoning:{effort:'high'},client_metadata:{thread_id:'synthetic-payload-test'},
  tools:[{type:'function',name:'dummy',parameters:{type:'object'}}],
  input:[{role:'user',content:[{type:'input_text',text:'Synthetic image review'},
    {type:'input_image',image_url:'data:image/png;base64,'+'A'.repeat(33*MiB)}]}]});

async function httpFixture(t,overrides={}) {
  const received=[],logs=[];let calls=0;
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const data=Buffer.concat(chunks),body=JSON.parse(data.toString());
    received.push({hash:digest(data),bytes:data.length,model:body.model,effort:body.reasoning?.effort,
      auth:req.headers.authorization,account:req.headers['chatgpt-account-id']});
    res.writeHead(200,{'content-type':'text/event-stream'}).end('data: '+JSON.stringify({type:'response.completed',response:{model:body.model}})+'\n\n');
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const config={...structuredClone(base),...overrides};config.providers.codex.upstream='http://127.0.0.1:'+upstream.address().port;
  const proxy=await startService({config:()=>config,port:0,catalog:()=>({models:[]}),logger:x=>logs.push(x),
    classifier:async()=>{calls++;return {choice:'haiku',confidence:1};}});
  t.after(async()=>{await proxy.close();await new Promise(resolve=>upstream.close(resolve));});
  return {config,received,logs,calls:()=>calls,origin:'http://127.0.0.1:'+proxy.port};
}

test('Legacy configurations get a bounded 128 MiB default; invalid limits are rejected',()=>{
  const config=structuredClone(base);delete config.maxPayloadBytes;
  assert.equal(payloadLimit(config),128*MiB);assert.equal(DEFAULT_MAX_PAYLOAD_BYTES,128*MiB);
  assert.equal(validateConfig(config),config);
  for(const value of [0,-1,MiB-1,512*MiB+1,1.5,'134217728',null]) {
    const candidate={...config,maxPayloadBytes:value};
    if(value===null)assert.equal(payloadLimit(candidate),128*MiB);
    else assert.throws(()=>validateConfig(candidate),/invalid_payload_limit/);
  }
  assert.equal(payloadLimit({...config,maxPayloadBytes:512*MiB}),512*MiB);
});

test('Screenshot-sized HTTP requests pass unchanged for manual Sol and still route Jev aliases',async t=>{
  const f=await httpFixture(t);
  const manual=JSON.stringify(imageTask('gpt-6.1-sol'),null,1)+'\n';
  const headers={'content-type':'application/json',authorization:'Bearer SYNTHETIC','chatgpt-account-id':'SYNTHETIC'};
  const first=await fetch(f.origin+'/codex/responses',{method:'POST',headers,body:manual});
  assert.equal(first.status,200);assert((await first.text()).includes('gpt-6.1-sol'));
  assert.deepEqual(f.received[0],{hash:digest(manual),bytes:Buffer.byteLength(manual),model:'gpt-6.1-sol',effort:'high',auth:'Bearer SYNTHETIC',account:'SYNTHETIC'});
  assert.equal(f.calls(),0);
  const second=await fetch(f.origin+'/codex/responses',{method:'POST',headers,body:JSON.stringify(imageTask('gpt-jev-auto'))});
  assert.equal(second.status,200);await second.text();assert.equal(f.calls(),1);
  assert.equal(f.received[1].model,base.providers.codex.tiers.FAST.model);
  assert.equal(f.received[1].effort,base.providers.codex.tiers.FAST.effort);
  assert(!JSON.stringify(f.logs).includes('data:image/'));assert(!JSON.stringify(f.logs).includes('SYNTHETIC'));
});

test('HTTP configured boundary accepts exact size and rejects oversized declared/chunked bodies clearly',async t=>{
  const limit=MiB,f=await httpFixture(t,{maxPayloadBytes:limit});
  const prefix=JSON.stringify({model:'gpt-6.1-sol',input:[]});
  const body=bytes=>prefix+' '.repeat(bytes-Buffer.byteLength(prefix));
  for(const bytes of [limit-1,limit]) {
    const response=await fetch(f.origin+'/codex/responses',{method:'POST',body:body(bytes)});
    assert.equal(response.status,200);await response.text();assert.equal(f.received.at(-1).bytes,bytes);
  }
  const response=await fetch(f.origin+'/codex/responses',{method:'POST',body:body(limit+1)});
  assert.equal(response.status,413);const error=(await response.json()).error;
  assert.equal(error.code,'payload_too_large');assert.equal(error.limit_bytes,limit);assert.equal(error.payload_bytes,limit+1);
  assert(error.message.includes('maxPayloadBytes'));assert.equal(f.received.length,2);
  const chunked=await new Promise((resolve,reject)=>{
    const request=http.request(f.origin+'/codex/responses',{method:'POST',headers:{'transfer-encoding':'chunked'}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,error:JSON.parse(text).error}));
    });
    request.on('error',reject);request.write(body(limit));request.end(' ');
  });
  assert.equal(chunked.status,413);assert.equal(chunked.error.code,'payload_too_large');assert.equal(chunked.error.limit_bytes,limit);
  assert.equal(f.received.length,2);assert.equal(f.calls(),0);
  assert.equal(f.logs.filter(x=>x.state==='payload-too-large').length,2);
  const health=await(await fetch(f.origin+'/health')).json();assert.equal(health.maxPayloadBytes,limit);
});

test('Routing cannot grow an accepted HTTP request past the configured limit',async t=>{
  const f=await httpFixture(t,{maxPayloadBytes:MiB});
  const task={model:'gpt-jev-auto',client_metadata:{thread_id:'synthetic-growth'},
    tools:[{type:'function',name:'dummy'}],input:[{role:'user',content:'Synthetic task'}],padding:''};
  task.padding='x'.repeat(MiB-Buffer.byteLength(JSON.stringify(task)));
  const response=await fetch(f.origin+'/codex/responses',{method:'POST',body:JSON.stringify(task)});
  assert.equal(response.status,413);const error=(await response.json()).error;
  assert.equal(error.code,'payload_too_large');assert(error.payload_bytes>MiB);assert.equal(f.received.length,0);
});

test('WebSocket manual image requests above 32 MiB preserve bytes and skip classification',async t=>{
  const upstream=http.createServer(),wss=new WebSocketServer({server:upstream,maxPayload:DEFAULT_MAX_PAYLOAD_BYTES});
  let receivedHash,calls=0;
  wss.on('connection',ws=>ws.on('message',data=>{
    receivedHash=digest(data);
    ws.send(JSON.stringify({type:'response.completed',response:{model:'gpt-6.1-sol'},padding:'X'.repeat(33*MiB)}));
  }));
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const config=structuredClone(base);delete config.maxPayloadBytes;config.providers.codex.upstream='http://127.0.0.1:'+upstream.address().port;
  const proxy=await startService({config:()=>config,port:0,catalog:()=>({models:[]}),logger:()=>{},classifier:async()=>{calls++;throw Error('No classifier for manual selections');}});
  const ws=new WebSocket('ws://127.0.0.1:'+proxy.port+'/codex/responses');
  t.after(async()=>{ws.terminate();await proxy.close();for(const client of wss.clients)client.terminate();await new Promise(resolve=>upstream.close(resolve));});
  await once(ws,'open');const body=JSON.stringify({...imageTask('gpt-6.1-sol'),type:'response.create'},null,1)+'\n';
  const reply=once(ws,'message');ws.send(body);const [data]=await reply;
  assert.equal(JSON.parse(data).response.model,'gpt-6.1-sol');assert.equal(receivedHash,digest(body));assert.equal(calls,0);
});

test('WebSocket oversized frames retain close code 1009 and bounded size-only diagnostics',async t=>{
  const upstream=http.createServer(),wss=new WebSocketServer({server:upstream});let received=0;
  wss.on('connection',ws=>ws.on('message',()=>{received++;}));upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const config=structuredClone(base);config.maxPayloadBytes=MiB;config.providers.codex.upstream='http://127.0.0.1:'+upstream.address().port;
  const logs=[],proxy=await startService({config:()=>config,port:0,catalog:()=>({models:[]}),logger:x=>logs.push(x)});
  const ws=new WebSocket('ws://127.0.0.1:'+proxy.port+'/codex/responses');
  t.after(async()=>{ws.terminate();await proxy.close();for(const client of wss.clients)client.terminate();await new Promise(resolve=>upstream.close(resolve));});
  await once(ws,'open');const closed=once(ws,'close');ws.send('X'.repeat(MiB+1));const [code]=await closed;
  assert.equal(code,1009);assert.equal(received,0);assert(logs.some(x=>x.state==='payload-too-large' && x.limit_bytes===MiB));
  assert(!JSON.stringify(logs).includes('XXX'));
});
