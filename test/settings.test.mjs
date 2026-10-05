import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../src/settings-store.mjs';
import {startService} from '../src/service.mjs';
import {routingCapabilities} from '../src/ui-metadata.mjs';
import {healthPresentation,privacyNotice} from '../ui/status.js';
const base=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');const c=structuredClone(base);c.extra={preserve:true};c.classifier.privateExtension='do-not-expose';fs.writeFileSync(file,JSON.stringify(c));const store=new SettingsStore({file,catalog:()=>({models:[{slug:'gpt-6-luna',supported_reasoning_levels:[{effort:'medium'}]},{slug:'gpt-jev-auto'}]})});return {dir,file,c,store};}
test('Settings projection excludes private/advanced fields and backup preserves original bytes',t=>{
 const {file,dir,c,store}=fixture(t),original=fs.readFileSync(file,'utf8'),input=store.read();
 assert(!JSON.stringify(input).includes('privateExtension'));assert(!JSON.stringify(input).includes('upstream'));assert(!input.settings.clients);assert(input.settings.variants.codex.luna);assert.equal(input.models.length,1);
 input.settings.providers.codex.tiers.FAST.effort='low';input.settings.routing.codex='conversation';
 const saved=store.save({revision:input.revision,settings:input.settings});const result=JSON.parse(fs.readFileSync(file));
 assert.equal(result.providers.codex.tiers.FAST.effort,'low');assert.deepEqual(result.variants,c.variants);assert.deepEqual(result.extra,c.extra);assert.deepEqual(result.classifier,c.classifier);assert.deepEqual(result.clients,c.clients);
 assert.notEqual(saved.revision,input.revision);assert.equal(fs.statSync(file).mode&0o777,0o600);
 const backup=path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0],'config.json');assert.equal(fs.readFileSync(backup,'utf8'),original);assert.equal(fs.statSync(backup).mode&0o777,0o600);
});
test('Settings metadata is bounded despite unknown client fields or malformed catalog entries',t=>{
 const {file,c}=fixture(t);c.clients.privateExtension='do-not-expose';fs.writeFileSync(file,JSON.stringify(c));
 const store=new SettingsStore({file,catalog:()=>({models:[null,{slug:'gpt-6-luna',supported_reasoning_levels:[null,{effort:'medium'}]},{slug:'gpt-6.1-sol',supported_reasoning_levels:{}},{slug:'invalid model'},{slug:'codex-auto-review',visibility:'hide'},{slug:'gpt-subscription-only',supported_in_api:false}]})});
 const snapshot=store.read();assert.deepEqual(snapshot.integrations,{codex:true,hermes:false,claude:false});assert(!JSON.stringify(snapshot).includes('privateExtension'));assert.deepEqual(snapshot.models,[{id:'gpt-6-luna',efforts:['medium']},{id:'gpt-6.1-sol',efforts:[]},{id:'gpt-subscription-only',efforts:[]}]);
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
test('Family profiles save independently, preserve extension fields and reject cross-family models',t=>{
 const {file,c,store}=fixture(t);c.variants.codex.luna.privateExtension='preserve';fs.writeFileSync(file,JSON.stringify(c));
 const before=store.read();assert(!JSON.stringify(before).includes('privateExtension'));before.settings.variants.codex.luna.tiers.FAST.effort='high';before.settings.routing.claude='conversation';
 const saved=store.save({revision:before.revision,settings:before.settings});const after=JSON.parse(fs.readFileSync(file));assert.equal(after.variants.codex.luna.tiers.FAST.effort,'high');assert.equal(after.variants.codex.luna.privateExtension,'preserve');assert.deepEqual(after.providers,c.providers);assert.deepEqual(after.variants.codex.sol,c.variants.codex.sol);
 const original=fs.readFileSync(file,'utf8');saved.settings.variants.codex.luna.tiers.FAST.model='gpt-6.1-sol';assert.throws(()=>store.save({revision:saved.revision,settings:saved.settings}),e=>e.status===400);assert.equal(fs.readFileSync(file,'utf8'),original);
});
test('Pre-profile settings clients preserve family maps and Claude timing',t=>{
 const {file,store,c}=fixture(t),snapshot=store.read();delete snapshot.settings.variants;delete snapshot.settings.routing.claude;snapshot.settings.classificationMaxChars=7000;
 store.save({revision:snapshot.revision,settings:snapshot.settings});const after=JSON.parse(fs.readFileSync(file));assert.deepEqual(after.variants,c.variants);assert.equal(after.classificationMaxChars,7000);assert.equal(after.routing.claude,c.routing.claude);
});

test('Committed save response uses its written snapshot without a post-commit reread',t=>{
 const {file,store}=fixture(t),snapshot=store.read();snapshot.settings.classificationMaxChars=7000;
 store.read=()=>{throw new Error('post-commit read must not run');};
 const saved=store.save({revision:snapshot.revision,settings:snapshot.settings});
 assert.equal(saved.settings.classificationMaxChars,7000);
 assert.equal(JSON.parse(fs.readFileSync(file)).classificationMaxChars,7000);
 const fresh=new SettingsStore({file,catalog:()=>({models:[]})}).read();assert.equal(saved.revision,fresh.revision);
});

test('Settings save remains successful when refreshing the catalog fails',async t=>{
 const {file,store}=fixture(t);let failCatalog=false;
 const catalog=()=>{if(failCatalog)throw Error('private catalog failure');return {models:[]};};store.catalog=catalog;
 const service=await startService({config:()=>JSON.parse(fs.readFileSync(file)),settingsStore:store,port:0,catalog,logger:()=>{}});t.after(()=>service.close());
 const origin='http://127.0.0.1:'+service.port,snapshot=await (await fetch(origin+'/settings/state')).json();failCatalog=true;
 snapshot.settings.classificationMaxChars=7000;
 const response=await fetch(origin+'/settings/state',{method:'POST',headers:{origin,'content-type':'application/json','x-jev-settings-token':snapshot.token},body:JSON.stringify({revision:snapshot.revision,settings:snapshot.settings})});
 assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.saved,true);assert.equal(saved.refreshRequired,true);assert.equal(saved.catalogUnavailable,true);assert.equal(saved.settings.classificationMaxChars,7000);
 assert.equal(JSON.parse(fs.readFileSync(file)).classificationMaxChars,7000);assert(!JSON.stringify(saved).includes('private catalog failure'));
});

test('Capabilities distinguish native Desktop, native CLI, Hermes Claude and unknown installation records',t=>{
 const {dir,c,store,file}=fixture(t);c.clients={codex:true,hermes:true,claude:true};c.routing={codex:'turn',hermes:'turn',claude:'conversation'};
 assert.equal(routingCapabilities(c,dir).codex.configurable,true);
 c.desktop.mode='hook-subagent';assert.equal(routingCapabilities(c,dir).codex.label,'Codex CLI');
 c.desktop.mode='native-first';let capabilities=routingCapabilities(c,dir);assert.equal(capabilities.codex.label,'Codex CLI');assert.equal(capabilities.codex.configurable,true);
 fs.writeFileSync(path.join(dir,'native-clients.json'),JSON.stringify({active:true,privatePath:'do-not-expose'}));
 capabilities=routingCapabilities(c,dir);assert.equal(capabilities.codex.configurable,false);assert.match(capabilities.codex.note,/once per chat/);assert.equal(capabilities.hermes.label,'Hermes · Claude');assert.equal(capabilities.hermes.configurable,true);
 fs.writeFileSync(file,JSON.stringify(c));const snapshot=store.read();snapshot.settings.classificationMaxChars=7000;store.save({revision:snapshot.revision,settings:snapshot.settings});
 assert.equal(JSON.parse(fs.readFileSync(file)).routing.codex,'turn');assert(!JSON.stringify(snapshot).includes('do-not-expose'));
 fs.writeFileSync(path.join(dir,'native-clients.json'),'{');assert.equal(routingCapabilities(c,dir).codex.configurable,false);assert.equal(routingCapabilities(c,dir).hermes.configurable,false);
});

test('Both pages describe degraded health and use the effective privacy limit and route',async t=>{
 const {file,c,store}=fixture(t);c.classificationMaxChars=30000;c.classifier.provider='typesafe';fs.writeFileSync(file,JSON.stringify(c));
 const service=await startService({config:()=>JSON.parse(fs.readFileSync(file)),settingsStore:store,port:0,catalog:()=>({models:[]}),logger:()=>{}});t.after(()=>service.close());
 const origin='http://127.0.0.1:'+service.port;
 const good=await (await fetch(origin+'/health')).json();assert.equal(good.classificationMaxChars,30000);assert.match(privacyNotice(good),/30,000/);assert.match(privacyNotice(good),/directly/);assert(!privacyNotice(good).includes('OpenRouter'));
 fs.writeFileSync(file,'{');const response=await fetch(origin+'/health'),bad=await response.json();assert.equal(response.status,503);assert.equal(bad.config_state,'last-valid');assert.equal(healthPresentation(bad,response.ok).label,'Needs attention');assert.match(healthPresentation(bad,response.ok).detail,/last valid/);
 assert.equal(healthPresentation(null).label,'Unavailable');assert.equal(healthPresentation({error:'unavailable'},false).label,'Unavailable');assert.equal(privacyNotice(null),null);
});

test('Advice rejects a changed disclosure before classification and allows the reviewed retry',async t=>{
 const {file,c,store}=fixture(t);let calls=0;
 const service=await startService({config:()=>JSON.parse(fs.readFileSync(file)),settingsStore:store,port:0,catalog:()=>({models:[]}),logger:()=>{},classifier:async()=>{calls++;return {choice:'haiku',confidence:1};}});t.after(()=>service.close());
 const origin='http://127.0.0.1:'+service.port;
 const post=disclosure=>fetch(origin+'/advice',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({prompt:'Synthetic task',provider:'codex',disclosure})});
 c.classificationMaxChars=30000;fs.writeFileSync(file,JSON.stringify(c));
 const response=await post({classifier:'openrouter',classificationMaxChars:8000});assert.equal(response.status,409);const changed=await response.json();assert.equal(calls,0);assert.equal(changed.classificationMaxChars,30000);
 assert.equal((await post({classifier:changed.classifier,classificationMaxChars:changed.classificationMaxChars})).status,200);assert.equal(calls,1);
 c.classifier.provider='typesafe';fs.writeFileSync(file,JSON.stringify(c));assert.equal((await post({classifier:'openrouter',classificationMaxChars:30000})).status,409);assert.equal(calls,1);
});
