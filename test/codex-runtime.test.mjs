import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {connect,snapshot,runtime,owner} from '../src/codex-runtime.mjs';

const expected=[{id:'gpt-jev-sol',displayName:'Jev Sol'},{id:'gpt-6.1-sol'}];
const models=expected.map(m=>({...m,displayName:m.displayName||'GPT Sol'}));
async function fixture(t,handler) {
  // macOS Unix socket paths are limited to 104 bytes.
  const dir=fs.mkdtempSync('/tmp/jev-runtime-'),codexHome=path.join(dir,'codex'),state=path.join(dir,'state');
  const socket=path.join(codexHome,'app-server-control/app-server-control.sock');
  fs.mkdirSync(path.dirname(socket),{recursive:true});
  const server=http.createServer(),wss=new WebSocketServer({server,
    verifyClient:({req})=>req.headers.host==='localhost' && !req.headers['sec-websocket-extensions']});
  const requests=[];
  wss.on('connection',ws=>ws.on('message',bytes=>{
    const request=JSON.parse(bytes);requests.push(request);
    if(request.id===undefined)return;
    const result=handler?.(request,ws)??(request.method==='model/list'?{data:models,nextCursor:null}:
      request.method==='thread/loaded/list'?{data:[],nextCursor:null}:{});
    if(result==='ignore')return;
    ws.send(JSON.stringify(result.error?{id:request.id,error:result.error}:{id:request.id,result}));
  }));
  await new Promise(resolve=>server.listen(socket,resolve));
  t.after(async()=>{for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  return {socket,requests,options:{codexHome,state,expected,codex:'codex'},pending:path.join(state,'codex-runtime-reload.json')};
}

test('real Unix WebSocket checks names, hidden models and all loaded-thread pages without turns',async t=>{
  const f=await fixture(t,request=>{
    if(request.method==='model/list')return request.params.cursor?{data:[models[1]]}:{data:[models[0]],nextCursor:'models-2'};
    if(request.method==='thread/loaded/list')return request.params.cursor?{data:['approval']}:{data:['idle'],nextCursor:'threads-2'};
    if(request.method==='thread/read')return {thread:{status:{type:request.params.threadId==='idle'?'idle':'active',activeFlags:['waitingOnApproval']}}};
  });
  assert.deepEqual(await snapshot(f.socket,expected),{missing:[],busy:1});
  assert(f.requests.find(r=>r.method==='model/list').params.includeHidden);
  assert(f.requests.filter(r=>r.method==='thread/read').every(r=>r.params.includeTurns===false));
  assert.equal(f.requests.filter(r=>r.method==='initialize').length,1);
});

test('RPC errors are redacted and timeouts close the connection',async t=>{
  const f=await fixture(t,r=>r.method==='model/list'?{error:{message:'PRIVATE PROMPT AND TOKEN'}}:undefined);
  await assert.rejects(snapshot(f.socket,expected),error=>error.message==='runtime_unavailable');
  const silent=await fixture(t,()=> 'ignore');
  await assert.rejects(connect(silent.socket,30),error=>error.message==='runtime_unavailable');
});

test('repeated page cursors fail closed',async t=>{
  const f=await fixture(t,r=>r.method==='model/list'?{data:models,nextCursor:'same'}:undefined);
  await assert.rejects(snapshot(f.socket,expected),/runtime_unavailable/);
});

test('unknown thread status and turn-start notification both prevent reload',async t=>{
  for(const mode of ['unknown','notification']) {
    const f=await fixture(t,(r,ws)=>{
      if(r.method==='thread/loaded/list')return {data:['thread']};
      if(r.method==='thread/read') {
        if(mode==='notification')ws.send(JSON.stringify({method:'turn/started',params:{threadId:'thread'}}));
        return {thread:{status:mode==='unknown'?{}:{type:'idle'}}};
      }
    });
    let signals=0;
    const service=runtime(f.options,{owner:()=>({pid:77,identity:'old'}),signal:()=>signals++});
    assert.equal((await service.check(true)).state,'reload-required');
    assert.equal((await service.reload()).state,'busy');assert.equal(signals,0);
  }
});

test('same IDs still require reload after config/context changes; no-op checks retain the journal',async t=>{
  const f=await fixture(t);let identity='old';
  const service=runtime(f.options,{owner:()=>({pid:77,identity})});
  assert.equal((await service.check()).state,'ready');
  assert.equal((await service.check(true)).state,'reload-required');
  assert.equal((await service.check()).state,'reload-required');
  identity='new';assert.equal((await service.check()).state,'ready');assert(!fs.existsSync(f.pending));
});

test('a later change supersedes an older pending process generation',async t=>{
  const f=await fixture(t);let identity='old';
  const service=runtime(f.options,{owner:()=>({pid:77,identity})});
  await service.check(true);identity='new';
  assert.equal((await service.check(true)).state,'reload-required');
  assert.equal(JSON.parse(fs.readFileSync(f.pending,'utf8')).identity,'new');
  identity='latest';assert.equal((await service.check()).state,'ready');
});

test('malformed notifications fail closed without leaking server content',async t=>{
  const f=await fixture(t,(r,ws)=>{
    if(r.method==='model/list'){ws.send(JSON.stringify({method:{secret:'PRIVATE CONTENT'}}));return 'ignore';}
  });
  await assert.rejects(snapshot(f.socket,expected),error=>error.message==='runtime_unavailable');
});

test('fresh process with missing catalog stays stale, including wrong picker label',async t=>{
  const f=await fixture(t,r=>r.method==='model/list'?{data:[{id:'gpt-jev-sol',displayName:'Custom'}]}:undefined);
  let identity='old';const service=runtime(f.options,{owner:()=>({pid:77,identity})});
  await service.check(true);identity='new';
  const check=await service.check();assert.equal(check.state,'reload-required');assert.deepEqual(check.missing,expected.map(m=>m.id));assert(fs.existsSync(f.pending));
});

test('unverifiable owner/RPC leaves pending changes and never signals',async t=>{
  const f=await fixture(t);let signals=0;
  const service=runtime(f.options,{owner:()=>{throw new Error('private command');},signal:()=>signals++});
  assert.deepEqual(await service.check(true),{state:'unavailable'});assert(fs.existsSync(f.pending));
  assert.deepEqual(await service.reload(),{state:'unavailable'});assert.equal(signals,0);
});

test('reload targets only the original idle process and accepts automatic Desktop replacement',async t=>{
  const f=await fixture(t);let identity='old',starts=0;const signals=[];
  const service=runtime(f.options,{owner:()=>({pid:identity==='old'?77:88,identity}),
    signal:pid=>{signals.push(pid);identity='new';},start:()=>starts++,sleep:async()=>{}});
  await service.check(true);assert.equal((await service.reload()).reloaded,true);
  assert.deepEqual(signals,[77]);assert.equal(starts,0);assert(!fs.existsSync(f.pending));
});

test('reload refuses activity arriving after initial inspection',async t=>{
  const f=await fixture(t);let probes=0,signals=0;
  const service=runtime(f.options,{owner:()=>({pid:77,identity:'old'}),
    snapshot:async()=>({missing:[],busy:++probes>=3?1:0}),signal:()=>signals++});
  await service.check(true);assert.equal((await service.reload()).state,'busy');assert.equal(signals,0);
});

test('owner change during final check blocks the signal',async t=>{
  const f=await fixture(t);let probes=0,identity='old',signals=0;
  const service=runtime(f.options,{owner:()=>({pid:77,identity}),
    snapshot:async()=>{if(++probes===3)identity='new';return {missing:[],busy:0};},signal:()=>signals++});
  await service.check(true);assert.equal((await service.reload()).state,'unavailable');assert.equal(signals,0);
});

test('a replacement before the final check is verified instead of terminated',async t=>{
  const f=await fixture(t);let calls=0,signals=0;
  const service=runtime(f.options,{owner:()=>({pid:77,identity:++calls>=5?'new':'old'}),signal:()=>signals++});
  await service.check(true);assert.equal((await service.reload()).state,'ready');assert.equal(signals,0);
});

test('idempotent daemon start is used only after the socket disappears',async t=>{
  const f=await fixture(t);let identity='old',starts=0;
  const service=runtime(f.options,{owner:()=>({pid:77,identity}),
    signal:()=>fs.unlinkSync(f.socket),sleep:async()=>{},
    snapshot:async()=>({missing:[],busy:0}),start:()=>{starts++;fs.writeFileSync(f.socket,'');identity='new';}});
  await service.check(true);assert.equal((await service.reload()).reloaded,true);assert.equal(starts,1);
});

test('failed start remains pending and never escalates to SIGKILL or retries the signal',async t=>{
  const f=await fixture(t);let signals=0,starts=0;
  const service=runtime(f.options,{owner:()=>({pid:77,identity:'old'}),
    signal:()=>{signals++;fs.unlinkSync(f.socket);},sleep:async()=>{},
    start:()=>{starts++;throw new Error('secret stderr');}});
  await service.check(true);assert.deepEqual(await service.reload(),{state:'unavailable'});
  assert.equal(signals,1);assert.equal(starts,1);assert(fs.existsSync(f.pending));
});

test('no running service is not started or signalled',async t=>{
  const dir=fs.mkdtempSync('/tmp/jev-runtime-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const service=runtime({codexHome:dir,state:dir,expected},{owner:()=>assert.fail(),signal:()=>assert.fail(),start:()=>assert.fail()});
  assert.deepEqual(await service.check(true),{state:'not-running',busy:0});
  assert.deepEqual(await service.reload(),{state:'not-running',busy:0});
});

test('process identity requires one owned Codex Unix app-server',()=>{
  const good={stat:()=>({isSocket:()=>true,uid:501,dev:1,ino:2}),uid:501,
    exec:command=>command.endsWith('lsof')?'p77\nccodex\nu501\nf30\nf37\n':'Mon Oct 5 08:00:00 2026 codex app-server --listen unix://socket'};
  assert.equal(owner('/tmp/socket',good).pid,77);
  for(const output of ['p77\nccodex\nu501\np88\nccodex\nu501','p77\ncnode\nu501','p77\nccodex\nu502','p1\nccodex\nu501']) {
    assert.throws(()=>owner('/tmp/socket',{...good,exec:command=>command.endsWith('lsof')?output:good.exec(command)}),/runtime_unavailable/);
  }
  assert.throws(()=>owner('/tmp/socket',{...good,stat:()=>({isSocket:()=>false,uid:501})}));
  assert.throws(()=>owner('/tmp/socket',{...good,exec:command=>command.endsWith('lsof')?good.exec(command):'codex exec hello'}));
});
