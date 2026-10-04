import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeRouting,LineObserver,receiptKey} from '../src/native-routing.mjs';

const config=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
config.routing.codex='conversation';
const catalog={models:[{slug:'gpt-6.1-sol',context_window:272000,supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'xhigh'}]},
  {slug:'gpt-6-luna',context_window:272000,supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'xhigh'}]}]};
function fixture(classifier=async()=>({choice:'haiku',confidence:1}),extra={}) {
  const logs=[];let calls=0;
  const router=new NativeRouting({config:()=>config,catalog:()=>catalog,logger:x=>logs.push(x),
    classifier:async prompt=>{calls++;return classifier(prompt);},...extra});
  return {router,logs,calls:()=>calls};
}
async function start(router,model='gpt-jev-auto',thread='thread-test') {
  const first={id:'start-'+thread,method:'thread/start',params:{model,modelProvider:'jev',cwd:'/synthetic',config:{extra:'preserve'}}};
  const result=await router.rewrite(first);
  router.observe({id:first.id,result:{thread:{id:thread},model:result.params.model,modelProvider:result.params.modelProvider}});
  return result;
}
const turn=(thread='thread-test',text='Synthetic task',model)=>({id:'turn-'+text,method:'turn/start',params:{threadId:thread,input:[{type:'text',text}],...(model?{model}:{})}});

test('Only first human input is classified; all native turns use a real model and direct provider',async()=>{
  const f=fixture(),initial=await start(f.router);
  assert.equal(initial.params.modelProvider,'openai');assert.equal(initial.params.model,'gpt-6.1-sol');
  assert.deepEqual(initial.params.config.extra,'preserve');
  const first=await f.router.rewrite(turn());assert.equal(first.params.model,'gpt-6-luna');assert.equal(first.params.effort,'medium');assert.equal(f.calls(),1);
  const followup=turn('thread-test','More work');assert.equal(await f.router.rewrite(followup),followup);
  const stalePicker=await f.router.rewrite(turn('thread-test','Again','gpt-jev-auto'));
  assert.equal(stalePicker.params.model,'gpt-6-luna');assert.equal(f.calls(),1);
  const interrupt={id:'interrupt',method:'turn/interrupt',params:{threadId:'thread-test',turnId:'native-turn'}};
  assert.equal(await f.router.rewrite(interrupt),interrupt);
  assert(!JSON.stringify(f.logs).includes('Synthetic task'));
});

test('Selecting a real model skips classification and preserves every setting and attachment',async()=>{
  const f=fixture(async()=>{throw Error('Must not classify manual choices');});
  await start(f.router,'gpt-6.1-sol');
  const request=turn('thread-test','Manual task','gpt-6.1-sol');
  request.params.effort='high';request.params.input.push({type:'localImage',path:'/synthetic/image.png'});
  request.params.approvalPolicy='on-request';request.params.toolOutput={arbitrary:'preserve'};
  assert.equal(await f.router.rewrite(request),request);assert.equal(f.calls(),0);
});

test('Classification only sees human text, never image data, tool outputs or past model context',async()=>{
  let captured;const f=fixture(async prompt=>{captured=prompt;return {choice:'haiku',confidence:1};});await start(f.router);
  const request=turn();request.params.input.push({type:'image',url:'data:image/png;base64,DO_NOT_SEND'});
  request.params.toolOutput={privateCode:'DO_NOT_SEND'};request.params.additionalContext=[{text:'DO_NOT_SEND'}];
  const result=await f.router.rewrite(request);
  assert.equal(captured,'Synthetic task');assert.deepEqual(result.params.input,request.params.input);
  assert.deepEqual(result.params.toolOutput,request.params.toolOutput);
});

test('Native collaboration mode gets the same selected model and effort without losing instructions',async()=>{
  const f=fixture(async()=>({choice:'fable',confidence:1}));await start(f.router);
  const request=turn();request.params.collaborationMode={mode:'default',settings:{model:'gpt-jev-auto',reasoning_effort:'low',developer_instructions:'preserve'}};
  const result=await f.router.rewrite(request);
  assert.equal(result.params.collaborationMode.settings.model,'gpt-6.1-sol');
  assert.equal(result.params.collaborationMode.settings.reasoning_effort,'xhigh');
  assert.equal(result.params.collaborationMode.settings.developer_instructions,'preserve');
});

test('Family profiles preserve family mappings, disabled routing and classifier failure fallbacks',async()=>{
  for(const family of ['luna','sol']) {
    const f=fixture(async()=>null),profile='gpt-jev-'+family;await start(f.router,profile,family);
    const result=await f.router.rewrite(turn(family));assert.equal(result.params.model,config.variants.codex[family].fallbackModel);
    assert.equal(f.calls(),1);
  }
  const disabled={...structuredClone(config),enabled:false};
  const f=fixture(async()=>{throw Error('Disabled classification');},{config:()=>disabled});await start(f.router);
  const result=await f.router.rewrite(turn());assert.equal(result.params.model,disabled.providers.codex.fallbackModel);assert.equal(f.calls(),0);
});

test('Same-profile followups and retries remain pinned; explicit manual picker choice remains manual',async()=>{
  const f=fixture();await start(f.router);await f.router.rewrite(turn());
  const settings={id:'settings',method:'thread/settings/update',params:{threadId:'thread-test',model:'gpt-6.1-sol',effort:'high'}};
  assert.equal(await f.router.rewrite(settings),settings);f.router.observe({id:'settings',result:{threadSettings:{}}});
  const manual=turn('thread-test','Manual followup','gpt-6.1-sol');assert.equal(await f.router.rewrite(manual),manual);assert.equal(f.calls(),1);
});

test('Model list aliases exist only in Desktop replies, never in the native provider catalog',async()=>{
  const f=fixture();await f.router.rewrite({id:'list',method:'model/list',params:{includeHidden:false}});
  const result=f.router.observe({id:'list',result:{data:[{id:'sol',model:'gpt-6.1-sol',displayName:'Sol',hidden:false,inputModalities:['text','image']}],nextCursor:null}});
  assert.deepEqual(result.result.data.slice(0,3).map(x=>x.model),['gpt-jev-auto','gpt-jev-luna','gpt-jev-sol']);
  assert.deepEqual(result.result.data[0].inputModalities,['text','image']);
  assert(!f.router.engine.models.has('gpt-jev-auto'));
});

test('Cold resume migrates saved Jev provider and preserves real model, effort, cwd and permissions',async()=>{
  const f=fixture(),request={id:'resume',method:'thread/resume',params:{threadId:'saved',model:null,modelProvider:null,cwd:'/synthetic',sandbox:'read-only'}};
  let query;
  const result=await f.router.rewrite(request,async(method,params)=>{query={method,params};return {thread:{modelProvider:'jev',model:'gpt-6.1-sol',reasoningEffort:'high'}};});
  assert.deepEqual(query,{method:'thread/read',params:{threadId:'saved',includeTurns:false}});
  assert.equal(result.params.modelProvider,'openai');assert.equal(result.params.model,'gpt-6.1-sol');assert.equal(result.params.config.model_reasoning_effort,'high');
  assert.equal(result.params.cwd,request.params.cwd);assert.equal(result.params.sandbox,request.params.sandbox);
  assert.equal(f.calls(),0);
});

test('Desktop resumes with a rollout path preserve their saved model; unavailable metadata stays unchanged',async()=>{
  const f=fixture(),request={id:'resume-path',method:'thread/resume',params:{threadId:'saved',path:'/synthetic/rollout.jsonl',model:null}};
  const output=await f.router.rewrite(request,async()=>({thread:{modelProvider:'jev',model:'gpt-6-luna',reasoningEffort:'medium',path:request.params.path}}));
  assert.equal(output.params.model,'gpt-6-luna');assert.equal(output.params.modelProvider,'openai');
  assert.equal(output.params.path,request.params.path);
  assert.equal(await f.router.rewrite(request,async()=>{throw Error('Unavailable metadata');}),request);
  assert.equal(await f.router.rewrite(request,async()=>({thread:{path:'/synthetic/different.jsonl',model:'gpt-6.1-sol'}})),request);
});

test('Legacy virtual chats recover their served real model from size-only routing receipts',async()=>{
  const pins=new Map([[receiptKey('saved'),{model:'gpt-6-luna',effort:'medium'}]]),f=fixture(undefined,{legacyPins:pins});
  const request={id:'resume',method:'thread/resume',params:{threadId:'saved'}};
  const result=await f.router.rewrite(request,async()=>({thread:{modelProvider:'jev',model:'gpt-jev-auto'}}));
  assert.equal(result.params.model,'gpt-6-luna');assert.equal(result.params.modelProvider,'openai');
  f.router.observe({id:'resume',result:{thread:{id:'saved'},modelProvider:'openai'}});
  const followup=turn('saved','Continue','gpt-jev-auto');assert.equal((await f.router.rewrite(followup)).params.model,'gpt-6-luna');assert.equal(f.calls(),0);
});

test('Other providers and unknown native RPC messages pass through unchanged',async()=>{
  const f=fixture();
  const meta={id:'meta',method:'thread/start',params:{model:'example-model',modelProvider:'meta'}};
  assert.equal(await f.router.rewrite(meta),meta);
  const request={id:'permissions',method:'item/commandExecution/requestApproval',params:{arbitrary:'preserve'}};
  assert.equal(await f.router.rewrite(request),request);
});

test('Cancellation during first classification does not submit the cancelled turn to native Codex',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;}));await start(f.router);
  const pending=f.router.rewrite(turn());await new Promise(resolve=>setImmediate(resolve));
  await f.router.rewrite({id:'cancel',method:'turn/interrupt',params:{threadId:'thread-test',turnId:'native-turn'}});
  release({choice:'haiku',confidence:1});await assert.rejects(pending,error=>error.code===-32800);
  const retry=f.router.rewrite(turn('thread-test','New task'));await new Promise(resolve=>setImmediate(resolve));
  release({choice:'fable',confidence:1});assert.equal((await retry).params.effort,'xhigh');assert.equal(f.calls(),2);
});

test('A manual model choice made during classification wins over the pending automatic choice',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;}));await start(f.router);
  const pending=f.router.rewrite(turn());await new Promise(resolve=>setImmediate(resolve));
  const request={id:'manual-during-routing',method:'thread/settings/update',params:{threadId:'thread-test',model:'gpt-6.1-sol',effort:'high'}};
  await f.router.rewrite(request);f.router.observe({id:request.id,result:{threadSettings:{}}});
  release({choice:'haiku',confidence:1});const result=await pending;
  assert.equal(result.params.model,'gpt-6.1-sol');assert.equal(result.params.effort,'high');
});

test('Huge native events are forwarded byte-for-byte without retaining the whole line',()=>{
  const chunks=[],observer=new LineObserver({maxBytes:32,emit:chunk=>chunks.push(chunk)});
  const input=Buffer.from('{"method":"item/completed","params":{"output":"'+'x'.repeat(5000)+'"}}\n');
  for(let i=0;i<input.length;i+=17) {observer.feed(input.subarray(i,i+17));assert(observer.bytes<=32);}
  assert.deepEqual(Buffer.concat(chunks),input);assert.equal(observer.parts.length,0);
});

test('Small RPC replies can be augmented or suppressed while unrelated messages are preserved',()=>{
  const chunks=[],observer=new LineObserver({emit:x=>chunks.push(x),inspect:x=>x.id==='internal'?null:{...x,observed:true}});
  observer.feed(Buffer.from('{"id":"internal","result":{}}\n{"id":"public","result":{}}\n'));
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),{id:'public',result:{},observed:true});
});

const nativeSettings=(threadId,model='gpt-6-luna',effort='medium')=>({method:'thread/settings/updated',params:{threadId,
  threadSettings:{model,effort,modelProvider:'openai',cwd:'/synthetic',approvalPolicy:'on-request',approvalsReviewer:'user',
    sandboxPolicy:{type:'readOnly',networkAccess:false},collaborationMode:{mode:'default',settings:{model,reasoning_effort:effort,developer_instructions:null}}}}});
const startedEvent=threadId=>({method:'turn/started',params:{threadId,turn:{id:'native-turn',status:'inProgress',items:[]}}});

test('Confirmed model settings follow turn/started so Desktop cannot leave its original Jev alias in the picker',async()=>{
  const f=fixture();await start(f.router);await f.router.rewrite(turn());
  const actual=nativeSettings('thread-test'),started=startedEvent('thread-test'),chunks=[];
  const observer=new LineObserver({inspect:x=>f.router.observe(x),afterInspect:x=>f.router.notificationsAfter(x),emit:x=>chunks.push(x)});
  observer.feed(Buffer.from(JSON.stringify(actual)+'\n'+JSON.stringify(started)+'\n'));
  const events=Buffer.concat(chunks).toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(events,[actual,started,actual]);
  // Reproduce Desktop's turn/started assignment from its optimistic request.
  let picker;
  for(const event of events) {
    if(event.method==='thread/settings/updated')picker=event.params.threadSettings.collaborationMode.settings;
    if(event.method==='turn/started')picker={model:'gpt-jev-auto',reasoning_effort:'low'};
  }
  assert.equal(picker.model,'gpt-6-luna');assert.equal(picker.reasoning_effort,'medium');assert.equal(f.calls(),1);
  assert.equal(f.router.notificationsAfter({method:'turn/completed',params:{threadId:'thread-test'}}).length,0);
});

test('Picker reconciliation uses the latest confirmed manual settings and stays confined to routed chats',async()=>{
  const f=fixture();await start(f.router);await f.router.rewrite(turn());
  f.router.observe(nativeSettings('thread-test'));
  const manual=nativeSettings('thread-test','gpt-6.1-sol','high');f.router.observe(manual);
  const actual=f.router.notificationsAfter(startedEvent('thread-test'));
  assert.deepEqual(actual,[manual]);actual[0].params.threadSettings.model='mutated';
  assert.equal(f.router.notificationsAfter(startedEvent('thread-test'))[0].params.threadSettings.model,'gpt-6.1-sol');
  await start(f.router,'gpt-6.1-sol','manual-chat');f.router.observe(nativeSettings('manual-chat','gpt-6.1-sol','low'));
  assert.deepEqual(f.router.notificationsAfter(startedEvent('manual-chat')),[]);
  assert.deepEqual(f.router.notificationsAfter(startedEvent('unknown-chat')),[]);
  f.router.observe({...manual,params:{...manual.params,threadSettings:{...manual.params.threadSettings,modelProvider:'other'}}});
  assert.deepEqual(f.router.notificationsAfter(startedEvent('thread-test')),[]);
});

test('Picker reconciliation never invents settings when the native runtime has not confirmed them',async()=>{
  const f=fixture();await start(f.router);await f.router.rewrite(turn());
  assert.deepEqual(f.router.notificationsAfter(startedEvent('thread-test')),[]);
  const original=nativeSettings('thread-test');f.router.observe(original);
  original.params.threadSettings.effort='low';
  assert.equal(f.router.notificationsAfter(startedEvent('thread-test'))[0].params.threadSettings.effort,'medium');
});

test('Following notifications do not run for suppressed replies or huge streamed events',()=>{
  let calls=0;const chunks=[],observer=new LineObserver({maxBytes:64,inspect:x=>x.id==='private'?null:x,
    afterInspect:()=>{calls++;return [{method:'confirmed'}];},emit:x=>chunks.push(x)});
  const privateReply=Buffer.from('{"id":"private","result":{}}\n');observer.feed(privateReply);
  const huge=Buffer.from('{"method":"item/completed","params":{"text":"'+'x'.repeat(300)+'"}}\n');observer.feed(huge);
  assert.deepEqual(Buffer.concat(chunks),huge);assert.equal(calls,0);assert.equal(observer.bytes,0);
});

test('Cold resume keeps saved real model and effort when the new-chat default is still Jev',async()=>{
  const f=fixture(async()=>{throw Error('Resumes must not classify');});
  const message={id:'cold-resume-default',method:'thread/resume',params:{threadId:'cold',model:'gpt-jev-auto',modelProvider:'jev'}};
  const output=await f.router.rewrite(message,async()=>({thread:{id:'cold',model:'gpt-6-luna',reasoningEffort:'high',modelProvider:'openai'}}));
  assert.equal(output.params.model,'gpt-6-luna');assert.equal(output.params.config.model_reasoning_effort,'high');
  f.router.observe({id:message.id,result:{thread:{id:'cold'},modelProvider:'openai'}});
  const next=await f.router.rewrite(turn('cold','Synthetic resumed message','gpt-jev-auto'));
  assert.equal(next.params.model,'gpt-6-luna');assert.equal(next.params.effort,'high');assert.equal(f.calls(),0);
});
