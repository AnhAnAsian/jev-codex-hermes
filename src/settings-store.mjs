import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {configPath,validateConfig,loadModelCatalog} from './settings.mjs';

const tiers=['FAST','BALANCED','STRONG','LONG'];
const revision=text=>createHash('sha256').update(text).digest('hex');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
function keys(x,expected) {
  if(!object(x) || Object.keys(x).length!==expected.length || expected.some(k=>!Object.hasOwn(x,k)))fail('invalid_settings');
}
export function editableSettings(c) {
  return {enabled:c.enabled,classificationMaxChars:c.classificationMaxChars,disabledTiers:[...c.disabledTiers],
    routing:{codex:c.routing?.codex||'turn',hermes:c.routing?.hermes||'turn'},
    providers:Object.fromEntries(['codex','claude'].map(name=>[name,{
      fallbackModel:c.providers[name].fallbackModel,fallbackEffort:c.providers[name].fallbackEffort,
      tiers:Object.fromEntries(tiers.map(t=>[t,{model:c.providers[name].tiers[t].model,effort:c.providers[name].tiers[t].effort}]))
    }]))};
}
export class SettingsStore {
  constructor({file=configPath,catalog=loadModelCatalog}={}) {this.file=file;this.catalog=catalog;}
  read() {
    const text=fs.readFileSync(this.file,'utf8');
    const c=validateConfig(JSON.parse(text));
    const models=(this.catalog()?.models||[]).filter(m=>typeof m.slug==='string' && !m.slug.includes('jev-'))
      .map(m=>({id:m.slug,efforts:(m.supported_reasoning_levels||[]).map(e=>e.effort).filter(e=>typeof e==='string')}));
    return {revision:revision(text),settings:editableSettings(c),models,
      integrations:{...c.clients},classifier:c.classifier?.provider||'typesafe'};
  }
  save(input) {
    keys(input,['revision','settings']);
    if(typeof input.revision!=='string' || !/^[a-f0-9]{64}$/.test(input.revision))fail('invalid_revision');
    const original=fs.readFileSync(this.file,'utf8');
    if(revision(original)!==input.revision)fail('settings_changed',409);
    const c=validateConfig(JSON.parse(original)),s=input.settings;
    const previousModels=JSON.stringify(['codex','claude'].map(n=>[c.providers[n].fallbackModel,...tiers.map(t=>c.providers[n].tiers[t].model)]));
    keys(s,['enabled','classificationMaxChars','disabledTiers','routing','providers']);
    keys(s.routing,['codex','hermes']);keys(s.providers,['codex','claude']);
    for(const name of ['codex','claude']) {
      const p=s.providers[name];keys(p,['fallbackModel','fallbackEffort','tiers']);keys(p.tiers,tiers);
      for(const t of tiers)keys(p.tiers[t],['model','effort']);
      c.providers[name].fallbackModel=p.fallbackModel;c.providers[name].fallbackEffort=p.fallbackEffort;
      for(const t of tiers)c.providers[name].tiers[t]={...c.providers[name].tiers[t],...p.tiers[t]};
    }
    c.enabled=s.enabled;c.classificationMaxChars=s.classificationMaxChars;c.disabledTiers=s.disabledTiers;
    c.routing={...c.routing,...s.routing};
    try{validateConfig(c);}catch{fail('invalid_settings');}
    const dir=path.dirname(this.file),backup=path.join(dir,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(backup,'config.json'),original,{mode:0o600,flag:'wx'});
    const tmp=path.join(dir,'.config-'+randomUUID()+'.tmp');
    try {
      fs.writeFileSync(tmp,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'});
      // Reject a concurrent external editor before replacing its newer contents.
      if(fs.readFileSync(this.file,'utf8')!==original)fail('settings_changed',409);
      fs.renameSync(tmp,this.file);
    }finally{fs.rmSync(tmp,{force:true});}
    const modelsChanged=previousModels!==JSON.stringify(['codex','claude'].map(n=>[c.providers[n].fallbackModel,...tiers.map(t=>c.providers[n].tiers[t].model)]));
    return {...this.read(),modelsChanged};
  }
}
