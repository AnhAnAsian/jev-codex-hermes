import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import WebSocket,{WebSocketServer} from 'ws';
import {RoutingEngine} from '../src/routing.mjs';
import {startService} from '../src/service.mjs';
import {labels} from '../src/settings.mjs';
const c=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../config.example.json',import.meta.url))));
c.clients={codex:true,hermes:true,claude:true};
c.routing={}; // Most baseline tests deliberately exercise per-turn routing.
c.desktop.mode='hook-subagent'; // Exercise the retained fallback as well as advice-only mode.
for(const [provider,p] of Object.entries(c.providers))for(const [tier,s] of Object.entries(p.tiers)) {
  process.env[`JEV_${provider.toUpperCase()}_${tier}_MODEL`]=s.model;
  if(s.effort)process.env[`JEV_${provider.toUpperCase()}_${tier}_EFFORT`]=s.effort;
}
const body=(prompt,thread='main')=>({model:'jev-auto',client_metadata:{thread_id:thread},prompt_cache_key:'shared-cache',input:[{role:'user',content:prompt}],tools:[{type:'function',name:'dummy',parameters:{type:'object'}}],reasoning:{effort:'xhigh'}});
test('Desktop hook classifies once per turn and fails open on missing classifier',async()=>{
  let calls=0;const e=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  const input={prompt:'Rename a variable and fix a typo.',session_id:'s',turn_id:'t',model:'gpt-6.1-sol'};
  const first=await e.desktopDecision(input);assert.equal(first.model,c.providers.codex.tiers.FAST.model);
  await e.desktopDecision(input);assert.equal(calls,1);
  const fail=new RoutingEngine({config:()=>c,classifier:async()=>null,logger:()=>{}});assert.equal(await fail.desktopDecision(input),null);
  assert.equal(await e.desktopDecision({...input,model:'gpt-6-astra'}),null);
});
test('All four tiers apply model and effort; retries and tool loops classify once',async()=>{
  for(const [tier,label] of Object.entries(labels)) {
    let calls=0;const logs=[];
    const e=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;return {choice:tier,confidence:1};},logger:x=>logs.push(x)});
    const b=body('Task '+label);const first=await e.rewrite(b,'codex','codex');
    assert.equal(first.body.model,c.providers.codex.tiers[label].model);
    assert.equal(first.body.reasoning.effort,c.providers.codex.tiers[label].effort);
    await e.rewrite(body('Task '+label),'codex','codex');
    const tool=body('Task '+label);tool.input.push({type:'function_call_output',call_id:'1',output:'arbitrary code secret'});
    const loop=await e.rewrite(tool,'codex','codex');assert.equal(loop.body.model,first.body.model);assert.equal(calls,1);
    const next=body('Task '+label);next.input.push({role:'assistant',content:'done'},{role:'user',content:'Task '+label});
    await e.rewrite(next,'codex','codex');assert.equal(calls,2);
    assert(!JSON.stringify(logs).includes('Task '));assert(!JSON.stringify(logs).includes('arbitrary code secret'));
  }
});
test('Explicit overrides skip Jev; manual model selection passes through',async()=>{
  let calls=0;const e=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;throw Error('must not call');},logger:()=>{}});
  for(const prompt of ['use fast tier: fix a typo','use opus: debug','use sol: debug','use deep tier: design']) {
    const r=await e.rewrite(body(prompt,prompt),'codex','codex');assert.notEqual(r.body.model,'jev-auto');
  }
  const b=body('hard task');b.model='gpt-6-astra';const r=await e.rewrite(b,'codex','codex');assert.equal(r.body.model,'gpt-6-astra');assert.equal(calls,0);
  const explicit=await e.rewrite(body('use gpt-6-sol: debug','explicit'),'codex','codex');assert.equal(explicit.body.model,'gpt-6-sol');assert.equal(calls,0);
});
test('Classifier failure and global disable preserve saved normal model',async()=>{
  const e=new RoutingEngine({config:()=>c,classifier:async()=>null,logger:()=>{}});
  assert.equal((await e.rewrite(body('task'),'codex','codex')).body.model,'gpt-6.1-sol');
  const disabled={...c,enabled:false};const d=new RoutingEngine({config:()=>disabled,classifier:async()=>{throw Error();},logger:()=>{}});
  assert.equal((await d.rewrite(body('task'),'codex','codex')).body.model,'gpt-6.1-sol');
});
test('Subagents do not overwrite parent state and handback stays pinned',async()=>{
  let calls=0;const e=new RoutingEngine({config:()=>c,classifier:async prompt=>{calls++;return {choice:prompt==='hard'?'opus':'haiku',confidence:1};},logger:()=>{}});
  const parent=await e.rewrite(body('hard','parent'),'codex','codex');
  await e.rewrite(body('cheap','child'),'codex','codex');
  const handback=body('hard','parent');handback.input.push({role:'user',content:'<subagent_notification>done</subagent_notification>'});
  const r=await e.rewrite(handback,'codex','codex');assert.equal(r.body.model,parent.body.model);assert.equal(calls,2);
});
test('Claude reuses upstream schema and Haiku capability normalization',async()=>{
  const e=new RoutingEngine({config:()=>c,classifier:async()=>({choice:'haiku',confidence:1}),logger:()=>{}});
  const b={model:'jev-auto',messages:[{role:'user',content:'typo'}],tools:[{name:'dummy',input_schema:{minimum:1,exclusiveMinimum:true}}],thinking:{type:'adaptive'},output_config:{effort:'high'}};
  const r=await e.rewrite(b,'claude','claude');assert.equal(r.body.model,c.providers.claude.tiers.FAST.model);assert(!r.body.thinking);assert(!r.body.output_config);assert.equal(r.body.tools[0].input_schema.exclusiveMinimum,1);
});
test('Claude 5.5 uses the configured model and adaptive thinking with no legacy budget',async()=>{
  for(const tier of ['sonnet','opus','fable']) {
    const e=new RoutingEngine({config:()=>c,classifier:async()=>({choice:tier,confidence:1}),logger:()=>{}});
    const b={model:'jev-auto',messages:[{role:'user',content:'ordinary task'}],tools:[{name:'dummy',input_schema:{type:'object'}}],thinking:{type:'enabled',budget_tokens:3000}};
    const r=await e.rewrite(b,'claude','claude');
    assert.equal(r.body.model,c.providers.claude.tiers[labels[tier]].model);
    assert.equal(r.body.thinking.type,'adaptive');assert(!('budget_tokens' in r.body.thinking));
    assert.equal(r.body.output_config.effort,c.providers.claude.tiers[labels[tier]].effort);
  }
});
test('HTTP streams untouched responses and forwards opaque authentication; remote origins rejected',async()=>{
  let received;const up=http.createServer(async(req,res)=>{
    const chunks=[];for await(const x of req)chunks.push(x);
    received={headers:req.headers,body:JSON.parse(Buffer.concat(chunks))};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('data: {"type":"response.created","response":{"model":"'+received.body.model+'"}}\n\n');res.end('data: [DONE]\n\n');
  });up.listen(0,'127.0.0.1');await once(up,'listening');
  const cfg=structuredClone(c);cfg.providers.codex.upstream='http://127.0.0.1:'+up.address().port;
  const logs=[];const service=await startService({config:()=>cfg,port:0,classifier:async()=>({choice:'sonnet',confidence:1}),logger:x=>logs.push(x)});
  try {
    const r=await fetch('http://127.0.0.1:'+service.port+'/codex/responses',{method:'POST',headers:{authorization:'Bearer TEST-NOT-A-REAL-TOKEN','chatgpt-account-id':'opaque-test-account','content-type':'application/json'},body:JSON.stringify(body('private task'))});
    const text=await r.text();assert(text.includes('[DONE]'));assert(!text.includes('[Jev]'));
    assert.equal(received.headers.authorization,'Bearer TEST-NOT-A-REAL-TOKEN');assert.equal(received.headers['chatgpt-account-id'],'opaque-test-account');
    assert.equal(received.body.model,c.providers.codex.tiers.BALANCED.model);
    assert(logs.some(x=>x.served_model===c.providers.codex.tiers.BALANCED.model));
    assert(!JSON.stringify(logs).includes('private task'));assert(!JSON.stringify(logs).includes('TEST-NOT'));
    const blocked=await fetch('http://127.0.0.1:'+service.port+'/health',{headers:{origin:'https://untrusted.example'}});assert.equal(blocked.status,403);
  }finally{await service.close();await new Promise(r=>up.close(r));}
});
test('WebSocket turn receives routed provider model and unchanged account/auth headers',async()=>{
  const up=http.createServer();const wss=new WebSocketServer({server:up});let auth,acct;
  wss.on('connection',(ws,req)=>{auth=req.headers.authorization;acct=req.headers['chatgpt-account-id'];ws.on('message',data=>{const b=JSON.parse(data);ws.send(JSON.stringify({type:'response.completed',response:{model:b.model}}));});});
  up.listen(0,'127.0.0.1');await once(up,'listening');
  const cfg=structuredClone(c);cfg.providers.codex.upstream='http://127.0.0.1:'+up.address().port;
  const logs=[];const service=await startService({config:()=>cfg,port:0,classifier:async()=>({choice:'fable',confidence:1}),logger:x=>logs.push(x)});
  const ws=new WebSocket('ws://127.0.0.1:'+service.port+'/codex/responses',{headers:{authorization:'Bearer FAKE','chatgpt-account-id':'FAKE'}});
  try {await once(ws,'open');const b=body('design');b.type='response.create';ws.send(JSON.stringify(b));const [result]=await once(ws,'message');assert.equal(JSON.parse(result).response.model,c.providers.codex.tiers.LONG.model);assert.equal(auth,'Bearer FAKE');assert.equal(acct,'FAKE');assert(logs.some(x=>x.effort==='xhigh'));}
  finally{ws.terminate();await service.close();for(const client of wss.clients)client.terminate();await new Promise(r=>up.close(r));}
});

test('OpenRouter transport reuses upstream questions, pins destination and reports served classifier',async()=>{
  const {createClassifierClient}=await import('../src/classifier-client.mjs');
  const {QUESTIONS}=await import('../upstream/src/config.mjs');
  let captured;
  const client=createClassifierClient({classifier:{provider:'openrouter',model:'jev-1.13'}},'synthetic-test-key',async(url,init)=>{
    captured={url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)};
    return new Response(JSON.stringify({model:'typesafe/jev-1.13-test',answers:{model_tier:{type:'choice',choice:'haiku',confidence:0.99,probabilities:{haiku:1}}}}),{status:200,headers:{'content-type':'application/json'}});
  });
  const response=await client.systemOne({state:{request:'synthetic task'},questions:QUESTIONS});
  assert.equal(captured.url,'https://openrouter.ai/api/v1/systemone');
  assert.equal(captured.body.model,'jev-1.13');
  assert.deepEqual(captured.body.questions,QUESTIONS);
  assert.equal(captured.headers.get('authorization'),'Bearer synthetic-test-key');
  assert.equal(response.model,'typesafe/jev-1.13-test');
  assert.equal(response.answers.model_tier.choice,'haiku');
  assert.throws(()=>createClassifierClient({classifier:{provider:'unknown'}},'synthetic-test-key'));
});

test('Classifier credential selection never sends TypeSafe keys to OpenRouter',async()=>{
  const {loadKey}=await import('../src/settings.mjs');
  const variables=['OPENROUTER_API_KEY','JEV_API_KEY','TYPESAFE_API_KEY'];
  const saved=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
  try {
    process.env.OPENROUTER_API_KEY='synthetic-openrouter';process.env.JEV_API_KEY='synthetic-typesafe';
    assert.equal(loadKey({classifier:{provider:'openrouter'}}),'synthetic-openrouter');
    assert.equal(loadKey({classifier:{provider:'typesafe'}}),'synthetic-typesafe');
  } finally {for(const k of variables)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});

test('Advice page and endpoint recommend tiers without delegation or prompt logging',async()=>{
  const cfg=structuredClone(c);cfg.desktop.mode='advice-only';
  let calls=0;const logs=[];
  const service=await startService({config:()=>cfg,port:0,classifier:async prompt=>{calls++;return {choice:prompt==='deep'?'fable':'haiku',confidence:1,classifier_model:'typesafe/jev-test'};},logger:x=>logs.push(x)});
  const base='http://127.0.0.1:'+service.port;
  const post=(route,input,headers={})=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)});
  try {
    const page=await fetch(base+'/');assert.equal(page.status,200);assert((await page.text()).includes('Choose before'));
    assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    for(const file of ['/advice.js','/advice.css'])assert.equal((await fetch(base+file)).status,200);
    const reply=await post('/advice',{prompt:'private task content',provider:'codex'});assert.equal(reply.status,200);
    const d=(await reply.json()).advice;assert.equal(d.model,cfg.providers.codex.tiers.FAST.model);assert.equal(d.effort,'medium');assert.equal(d.classifier_model,'typesafe/jev-test');
    assert(!JSON.stringify(logs).includes('private task content'));
    const hook=await post('/desktop/decision',{prompt:'private task content',model:'gpt-6.1-sol',session_id:'test'});
    assert.equal((await hook.json()).decision,null);assert.equal(calls,1);
    assert.equal((await post('/advice',{prompt:'task',provider:'bad'})).status,400);
    assert.equal((await post('/advice',{prompt:'task',provider:'codex'},{origin:'https://evil.example'})).status,403);
    assert.equal((await post('/advice',{prompt:'task',provider:'codex'},{origin:'http://localhost:1234'})).status,403);
    const deep=(await(await post('/advice',{prompt:'deep',provider:'claude'})).json()).advice;
    assert.equal(deep.model,cfg.providers.claude.tiers.LONG.model);assert.equal(deep.effort,'xhigh');
    cfg.enabled=false;
    assert.equal((await post('/advice',{prompt:'task',provider:'codex'})).status,503);assert.equal(calls,2);
  } finally {await service.close();}
});

test('Advice fails open without fabricating a recommendation; manual override skips classifier',async()=>{
  let calls=0;const engine=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;return null;},logger:()=>{}});
  assert((await engine.advice({prompt:'task',provider:'codex'})).error);
  const d=(await engine.advice({prompt:'use long tier',provider:'codex'})).advice;
  assert.equal(d.effort,'xhigh');assert.equal(d.confidence,null);assert.equal(calls,1);
});

test('Hermes conversation routing classifies once, pins effort and permits manual tier override',async()=>{
  const cfg=structuredClone(c);cfg.routing={hermes:'conversation'};
  let calls=0;const e=new RoutingEngine({config:()=>cfg,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  const first=await e.rewrite(body('first task','hermes-conversation'),'codex','hermes');
  assert.equal(first.body.model,c.providers.codex.tiers.FAST.model);
  const next=body('first task','hermes-conversation');next.input.push({role:'assistant',content:'done'},{role:'user',content:'a harder follow-up'});
  const pinned=await e.rewrite(next,'codex','hermes');assert.equal(pinned.receipt.state,'conversation-pinned');assert.equal(pinned.body.reasoning.effort,'medium');assert.equal(calls,1);
  const manual=body('use strong tier','hermes-conversation');const upgraded=await e.rewrite(manual,'codex','hermes');assert.equal(upgraded.body.model,'gpt-6.1-sol');assert.equal(upgraded.body.reasoning.effort,'high');assert.equal(calls,1);
  const follow=await e.rewrite(body('follow-up','hermes-conversation'),'codex','hermes');assert.equal(follow.body.reasoning.effort,'high');assert.equal(calls,1);
  await e.rewrite(body('new chat','new-hermes-conversation'),'codex','hermes');assert.equal(calls,2);
});

test('Hermes Codex-family virtual model is rewritten before upstream inference',async()=>{
  const cfg=structuredClone(c);cfg.routing={hermes:'conversation'};
  const e=new RoutingEngine({config:()=>cfg,classifier:async()=>({choice:'sonnet',confidence:1}),logger:()=>{}});
  const b=body('task','hermes-interactive');b.model='gpt-jev-auto';
  const r=await e.rewrite(b,'codex','hermes');assert.equal(r.body.model,'gpt-6.1-sol');assert.equal(r.body.reasoning.effort,'low');
});

test('Desktop code-mode additional_tools input routes the parent and pins follow-ups',async()=>{
  const cfg=structuredClone(c);cfg.routing={codex:'conversation'};
  let calls=0;const e=new RoutingEngine({config:()=>cfg,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  const b=body('arithmetic','desktop-code-mode');b.input.unshift({role:'developer',content:'startup context '.repeat(7000)});b.model='gpt-jev-auto';delete b.tools;b.input.unshift({type:'additional_tools',tools:[{type:'function',name:'example',parameters:{type:'object'}}]});
  const r=await e.rewrite(b,'codex','codex');assert.equal(r.body.model,'gpt-6-luna');assert.equal(r.body.reasoning.effort,'medium');assert.equal(r.body.input[0].type,'additional_tools');
  const next=structuredClone(b);next.model='gpt-jev-auto';next.input.push({role:'assistant',content:'4'},{role:'user',content:'next task'});
  assert.equal((await e.rewrite(next,'codex','codex')).receipt.state,'conversation-pinned');assert.equal(calls,1);
});

test('Family variants stay within the selected family for all tiers, failures and overrides',async()=>{
  for(const family of ['luna','sol'])for(const [tier,label] of Object.entries(labels)) {
    for(const client of ['codex','hermes']) {
      const cfg=structuredClone(c);cfg.routing={[client]:'conversation'};
      let calls=0;const e=new RoutingEngine({config:()=>cfg,classifier:async()=>{calls++;return {choice:tier,confidence:1};},logger:()=>{}});
      const make=prompt=>{const b=body(prompt,'family-thread');b.model='gpt-jev-'+family;return b;};
      const first=await e.rewrite(make('ordinary task'),'codex',client);
      assert.equal(first.body.model,c.variants.codex[family].tiers[label].model);assert.equal(first.body.reasoning.effort,c.variants.codex[family].tiers[label].effort);
      assert.equal(first.receipt.variant,family);
      const next=await e.rewrite(make('another task'),'codex',client);assert.equal(next.receipt.state,'conversation-pinned');assert.equal(calls,1);
      const cross=await e.rewrite(make('use gpt-6-astra for this task'),'codex',client);assert(cross.body.model.endsWith('-'+family));
      const overridden=await e.rewrite(make('use long tier'),'codex',client);assert.equal(overridden.body.reasoning.effort,'xhigh');assert(overridden.body.model.endsWith('-'+family));
      const fail=new RoutingEngine({config:()=>cfg,classifier:async()=>null,logger:()=>{}});
      const fallback=await fail.rewrite(make('ordinary task'),'codex',client);assert.equal(fallback.body.model,c.variants.codex[family].fallbackModel);
      cfg.enabled=false;assert((await e.rewrite(make('disabled task'),'codex',client)).body.model.endsWith('-'+family));
    }
  }
});

test('Switching family choices in the same thread cannot inherit the other family pin',async()=>{
  let calls=0;const e=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  for(const family of ['luna','sol','luna']) {
    const b=body('same task','shared-thread');b.model='gpt-jev-'+family;
    assert((await e.rewrite(b,'codex','codex')).body.model.endsWith('-'+family));
  }
  assert.equal(calls,2);
});

test('Model mentions, quotes, code and negation never select an exact extra-credit model',async()=>{
  let calls=0;const e=new RoutingEngine({config:()=>c,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  for(const [i,prompt] of ['What is wrong with gpt-6-astra?','Compare gpt-6-astra with gpt-6-luna','Do not use gpt-6-astra','"use gpt-6-astra" is a quoted instruction','```\nuse gpt-6-astra\n```','Explain running on gpt-6-astra'].entries()) {
    const r=await e.rewrite(body(prompt,'mention-'+i),'codex','codex');assert.equal(r.body.model,'gpt-6-luna');
  }
  assert.equal(calls,6);
  const explicit=await e.rewrite(body('Use model: gpt-6-astra: calculate','clear-directive'),'codex','codex');assert.equal(explicit.body.model,'gpt-6-astra');assert.equal(calls,6);
});

test('Final capability guards apply to exact selections, variants and disabled fallbacks',async()=>{
  const e=new RoutingEngine({config:()=>c,classifier:async()=>({choice:'fable',confidence:1}),logger:()=>{}});
  for(const enabled of [true,false]) {
    const cfg=structuredClone(c);cfg.enabled=enabled;cfg.providers.claude.fallbackModel='claude-haiku-4-5-20251001';
    const engine=new RoutingEngine({config:()=>cfg,logger:()=>{}});
    const r=await engine.rewrite({model:'jev-auto',messages:[{role:'user',content:'use claude-haiku-4-5-20251001: test'}],thinking:{type:'adaptive'},output_config:{effort:'high',format:{type:'json_schema'}},context_management:{edits:[{type:'clear_thinking_20251015'}]}},'claude','claude');
    assert(!r.body.thinking);assert(!r.body.output_config.effort);assert(r.body.output_config.format);assert(!r.body.context_management);
  }
  e.seedModels({models:[{slug:'gpt-6-luna',context_window:272000,supported_reasoning_levels:[{effort:'low'},{effort:'medium'}],default_reasoning_level:'medium'}]});
  const b=body('use long tier','clamp');b.model='gpt-jev-luna';assert.equal((await e.rewrite(b,'codex','codex')).body.reasoning.effort,'medium');
});

test('WebSocket tool-only continuation inherits model and effort without repeated tools',async()=>{
  const up=http.createServer();const wss=new WebSocketServer({server:up});const received=[];
  wss.on('connection',ws=>ws.on('message',data=>{received.push(JSON.parse(data));ws.send(JSON.stringify({type:'response.completed',response:{id:'response-test',model:received.at(-1).model}}));}));
  up.listen(0,'127.0.0.1');await once(up,'listening');
  const cfg=structuredClone(c);cfg.providers.codex.upstream='http://127.0.0.1:'+up.address().port;
  let calls=0;const service=await startService({config:()=>cfg,port:0,classifier:async()=>{calls++;return {choice:'haiku',confidence:1};},logger:()=>{}});
  const ws=new WebSocket('ws://127.0.0.1:'+service.port+'/codex/responses');
  try {
    await once(ws,'open');const first=body('fix typo','ws-continuation');first.type='response.create';ws.send(JSON.stringify(first));await once(ws,'message');
    ws.send(JSON.stringify({type:'response.create',model:'gpt-jev-auto',previous_response_id:'response-test',client_metadata:{thread_id:'ws-continuation'},input:[{type:'function_call_output',call_id:'1',output:'done'}]}));await once(ws,'message');
    assert.equal(received[1].model,received[0].model);assert.equal(received[1].reasoning.effort,received[0].reasoning.effort);assert.equal(calls,1);
  }finally{ws.terminate();await service.close();for(const client of wss.clients)client.terminate();await new Promise(r=>up.close(r));}
});

test('Malformed live config reports degraded health without crashing or losing inference',async()=>{
  let invalid=false;const up=http.createServer((req,res)=>res.end('{"model":"gpt-6-luna"}'));up.listen(0,'127.0.0.1');await once(up,'listening');
  const cfg=structuredClone(c);cfg.providers.codex.upstream='http://127.0.0.1:'+up.address().port;
  const service=await startService({config:()=>{if(invalid)throw Error('synthetic-invalid-config');return cfg;},port:0,classifier:async()=>({choice:'haiku',confidence:1}),logger:()=>{}});
  try {
    invalid=true;const base='http://127.0.0.1:'+service.port;
    const h=await fetch(base+'/health');assert.equal(h.status,503);assert.equal((await h.json()).config_state,'last-valid');
    const r=await fetch(base+'/codex/responses',{method:'POST',body:JSON.stringify(body('task')),headers:{'content-type':'application/json'}});assert.equal(r.status,200);
    invalid=false;assert.equal((await (await fetch(base+'/health')).json()).service,'jev-desktop-hermes');
    assert.equal((await fetch(base+'/health',{headers:{origin:'http://127.0.0.1:1'}})).status,403);
  }finally{await service.close();await new Promise(r=>up.close(r));}
});

test('Configuration schema rejects missing tiers, invalid efforts and recursive fallbacks',async()=>{
  const {validateConfig}=await import('../src/settings.mjs');assert.equal(validateConfig(structuredClone(c)).port,c.port);
  for(const mutate of [cfg=>delete cfg.providers.codex.tiers.FAST,cfg=>cfg.providers.codex.fallbackModel='gpt-jev-auto',cfg=>cfg.providers.codex.tiers.FAST.effort='typo',cfg=>cfg.clients.codex='yes',cfg=>cfg.disabledTiers=['BOGUS']]) {
    const cfg=structuredClone(c);mutate(cfg);assert.throws(()=>validateConfig(cfg));
  }
});

test('Runtime seeds model availability and capabilities without a GET models request',async()=>{
  const service=await startService({config:()=>c,port:0,catalog:()=>({models:[{slug:'gpt-6.1-sol',context_window:400000,default_reasoning_level:'low',supported_reasoning_levels:[{effort:'low'}]}]}),classifier:async()=>({choice:'haiku',confidence:1}),logger:()=>{}});
  try {
    assert(service.engine.models.has('gpt-6.1-sol'));
    const r=await service.engine.rewrite(body('typo','seeded'),'codex','codex');assert.equal(r.body.model,'gpt-6.1-sol');assert.equal(r.body.reasoning.effort,'low');
    const b=body('use long tier','seeded-variant');b.model='gpt-jev-sol';assert.equal((await service.engine.rewrite(b,'codex','codex')).body.reasoning.effort,'low');
  }finally{await service.close();}
});

test('Served-model receipts ignore model text in generated deltas',async()=>{
  const {servedInspector}=await import('../src/service.mjs');const logs=[];const inspect=servedInspector({},'http',x=>logs.push(x));
  inspect(Buffer.from('data: {"type":"response.output_text.delta","delta":"model: gpt-6-astra","model":"gpt-6-astra"}\n\n'));
  assert.equal(logs.length,0);inspect(Buffer.from('data: {"type":"response.created","response":{"model":"gpt-6-luna"}}\n\n'));assert.equal(logs[0].served_model,'gpt-6-luna');
});
