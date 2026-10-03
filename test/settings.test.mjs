import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../src/settings-store.mjs';
import {startService} from '../src/service.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');const c=structuredClone(base);c.extra={preserve:true};c.classifier.privateExtension='do-not-expose';fs.writeFileSync(file,JSON.stringify(c));const store=new SettingsStore({file,catalog:()=>({models:[{slug:'gpt-6-luna',supported_reasoning_levels:[{effort:'medium'}]},{slug:'gpt-jev-auto'}]})});return {dir,file,c,store};}
test('Settings projection excludes private/advanced fields and backup preserves original bytes',t=>{
 const {file,dir,c,store}=fixture(t),original=fs.readFileSync(file,'utf8'),input=store.read();
 assert(!JSON.stringify(input).includes('privateExtension'));assert(!JSON.stringify(input).includes('upstream'));assert(!input.settings.clients);assert(!input.settings.variants);assert.equal(input.models.length,1);
 input.settings.providers.codex.tiers.FAST.effort='low';input.settings.routing.codex='conversation';
 const saved=store.save({revision:input.revision,settings:input.settings});const result=JSON.parse(fs.readFileSync(file));
 assert.equal(result.providers.codex.tiers.FAST.effort,'low');assert.deepEqual(result.variants,c.variants);assert.deepEqual(result.extra,c.extra);assert.deepEqual(result.classifier,c.classifier);assert.deepEqual(result.clients,c.clients);
 assert.notEqual(saved.revision,input.revision);assert.equal(fs.statSync(file).mode&0o777,0o600);
 const backup=path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0],'config.json');assert.equal(fs.readFileSync(backup,'utf8'),original);assert.equal(fs.statSync(backup).mode&0o777,0o600);
});
test('Settings metadata is bounded despite unknown client fields or malformed catalog entries',t=>{
 const {file,c}=fixture(t);c.clients.privateExtension='do-not-expose';fs.writeFileSync(file,JSON.stringify(c));
 const store=new SettingsStore({file,catalog:()=>({models:[null,{slug:'gpt-6-luna',supported_reasoning_levels:[null,{effort:'medium'}]},{slug:'gpt-6.1-sol',supported_reasoning_levels:{}},{slug:'invalid model'}]})});
 const snapshot=store.read();assert.deepEqual(snapshot.integrations,{codex:true,hermes:false,claude:false});assert(!JSON.stringify(snapshot).includes('privateExtension'));assert.deepEqual(snapshot.models,[{id:'gpt-6-luna',efforts:['medium']},{id:'gpt-6.1-sol',efforts:[]}]);
});
test('Settings reject stale saves, prototype/unknown fields and invalid maps without writes',t=>{
 const {file,dir,store}=fixture(t),original=fs.readFileSync(file,'utf8'),snapshot=store.read();
 for(const alter of [s=>{s.port=80;},s=>{s.providers.codex.upstream='https://attacker.example';},s=>{s.providers.codex.tiers.FAST.model='gpt-jev-auto';},s=>{s.providers.codex.tiers.FAST.effort='bad';},s=>{s.routing.codex='invalid';},s=>{s.classificationMaxChars=90000;},s=>{s.disabledTiers=['UNKNOWN'];},s=>{s.enabled='false';},s=>{s.providers.codex.tiers.FAST.extra='bad';}]) {
  const settings=structuredClone(snapshot.settings);alter(settings);assert.throws(()=>store.save({revision:snapshot.revision,settings}),e=>e.status===400);assert.equal(fs.readFileSync(file,'utf8'),original);
 }
 assert(!fs.existsSync(path.join(dir,'backups')));
 fs.appendFileSync(file,'\n');assert.throws(()=>store.save({revision:snapshot.revision,settings:snapshot.settings}),e=>e.status===409);
});
test('Settings HTTP API requires same-origin and token; applies live changes without exposing keys',async t=>{
 const {file,store}=fixture(t);const logs=[];
 const service=await startService({config:()=>JSON.parse(fs.readFileSync(file)),settingsStore:store,port:0,catalog:()=>({models:[]}),logger:x=>logs.push(x),classifier:async()=>({choice:'haiku',confidence:1})});
 t.after(()=>service.close());const origin='http://127.0.0.1:'+service.port;
 const r=await fetch(origin+'/settings/state');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json();
 const headers={'content-type':'application/json',origin,'x-jev-settings-token':data.token},body=JSON.stringify({revision:data.revision,settings:{...data.settings,enabled:false}});
 for(const h of [{...headers,origin:'https://evil.example'},{...headers,'x-jev-settings-token':'bad'},{'content-type':'application/json','x-jev-settings-token':data.token}])assert.equal((await fetch(origin+'/settings/state',{method:'POST',headers:h,body})).status,403);
 assert.equal((await fetch(origin+'/settings/state',{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,415);
 assert.equal((await fetch(origin+'/settings/state',{method:'POST',headers,body:'x'.repeat(33000)})).status,413);
 const saved=await fetch(origin+'/settings/state',{method:'POST',headers,body});assert.equal(saved.status,200);assert.equal((await saved.json()).settings.enabled,false);
 assert.equal((await (await fetch(origin+'/health')).json()).enabled,false);
 assert.equal((await fetch(origin+'/settings/state',{method:'POST',headers,body})).status,409);
 assert.equal((await fetch(origin+'/settings/state',{method:'DELETE'})).status,405);
 const page=await fetch(origin+'/settings');assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
 assert.equal(logs.length,0);
});
test('Settings save changes routing on new chats while existing conversation remains pinned',async t=>{
 const {file,store}=fixture(t);let calls=0;
 const service=await startService({config:()=>JSON.parse(fs.readFileSync(file)),settingsStore:store,port:0,catalog:()=>({models:[]}),logger:()=>{},classifier:async()=>{calls++;return {choice:'haiku',confidence:1};}});t.after(()=>service.close());
 const task=(thread,prompt)=>({model:'gpt-jev-auto',client_metadata:{thread_id:thread},input:[{role:'user',content:prompt}],tools:[{type:'function',name:'dummy'}]});
 const first=await service.engine.rewrite(task('old','first'),'codex','codex');assert.equal(first.body.reasoning.effort,'medium');
 const data=store.read();data.settings.providers.codex.tiers.FAST={model:'gpt-6-sol',effort:'high'};store.save({revision:data.revision,settings:data.settings});
 const pinned=await service.engine.rewrite(task('old','follow up'),'codex','codex');assert.equal(pinned.body.model,'gpt-6-luna');assert.equal(pinned.body.reasoning.effort,'medium');
 const fresh=await service.engine.rewrite(task('new','first'),'codex','codex');assert.equal(fresh.body.model,'gpt-6-sol');assert.equal(fresh.body.reasoning.effort,'high');assert.equal(calls,2);
});
