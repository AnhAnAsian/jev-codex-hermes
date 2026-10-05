import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {modelChoices,modelName,reasoningValues,compatibleEffort,settingsEqual,changedSections} from '../ui/settings-controls.js';
import {editableSettings} from '../src/settings-store.mjs';
const settings=editableSettings(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8')));
const data={settings,models:[{id:'gpt-6-luna',efforts:['low','medium','high']},{id:'gpt-6.1-sol',efforts:['low','high','xhigh']},{id:'gpt-6-astra',efforts:['high']}]};
test('Model dropdown offers discovered models and preserves unlisted saved/custom IDs',()=>{
 const changed=structuredClone(data);changed.settings.providers.codex.tiers.FAST.model='gpt-6.0-luna';
 let choices=modelChoices(changed,'codex');assert(choices.some(x=>x.id==='gpt-6-luna'&&x.known));assert(choices.some(x=>x.id==='gpt-6.0-luna'&&!x.known));assert(choices.some(x=>x.id==='gpt-6-astra'&&x.extra));assert.equal(new Set(choices.map(x=>x.id)).size,choices.length);
 changed.settings.providers.codex.tiers.BALANCED.model='custom-model';choices=modelChoices(changed,'codex');assert(choices.some(x=>x.id==='custom-model'));
 assert.equal(modelName('gpt-6.1-sol'),'GPT-6.1 Sol');
});
test('Provider dropdown lists configured Claude models without leaking Codex choices',()=>{
 const choices=modelChoices(data,'claude');assert(choices.every(x=>x.id.startsWith('claude-')&&!x.known));assert(choices.some(x=>x.id==='claude-opus-5-5'));assert.equal(choices.length,3);
});
test('Model changes use compatible reasoning; unknown model choices remain editable',()=>{
 const values=reasoningValues(data,'codex','gpt-6.1-sol');assert.deepEqual(values,['low','high','xhigh']);assert.equal(compatibleEffort(values,'medium'),'low');assert.equal(compatibleEffort(values,'high'),'high');
 assert.deepEqual(reasoningValues(data,'claude','claude-haiku-4-5-20251001'),['']);assert.equal(compatibleEffort([''],'high'),'');assert(reasoningValues(data,'codex','custom-model').includes('medium'));
});
test('Dirty comparison resets after reverting edits and ignores disabled tier ordering',()=>{
 const changed=structuredClone(settings);assert(settingsEqual(changed,settings));changed.providers.codex.tiers.FAST.effort='high';assert(!settingsEqual(changed,settings));changed.providers.codex.tiers.FAST.effort='medium';assert(settingsEqual(changed,settings));
 changed.disabledTiers=['FAST','LONG'];const reordered={...changed,disabledTiers:['LONG','FAST']};assert(settingsEqual(changed,reordered));
});
const {profileChoices,profileMap,profileError}=await import('../ui/settings-controls.js');
test('Routing profiles restrict suggestions by family and keep separate drafts',()=>{
 assert.deepEqual(profileChoices(settings).map(p=>p.id),['codex','luna','sol','claude']);
 assert(modelChoices(data,'codex','luna').every(p=>p.id.endsWith('-luna')));assert(modelChoices(data,'codex','sol').every(p=>p.id.endsWith('-sol')));
 const changed=structuredClone(settings);profileMap(changed,'luna').tiers.FAST.effort='high';assert.equal(profileMap(changed,'codex').tiers.FAST.effort,'medium');assert.equal(profileMap(changed,'sol').tiers.FAST.effort,'low');assert.equal(profileError(changed),null);
 profileMap(changed,'luna').tiers.STRONG.model='gpt-6.1-sol';assert.equal(profileError(changed).profile,'luna');assert.equal(profileError(changed).field,'STRONG');
});
test('Change summary separates profile edits from global changes and catches hidden invalid model IDs',()=>{
 const changed=structuredClone(settings);changed.variants.codex.sol.tiers.FAST.effort='high';changed.disabledTiers=['LONG'];
 assert.deepEqual(changedSections(settings,changed),['Jev Sol','Global settings']);
 changed.providers.codex.tiers.FAST.model='bad model';assert.equal(profileError(changed).profile,'codex');
});
