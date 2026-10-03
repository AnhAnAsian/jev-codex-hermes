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
  const mapping=p=>({fallbackModel:p.fallbackModel,fallbackEffort:p.fallbackEffort,
    tiers:Object.fromEntries(tiers.map(t=>[t,{model:p.tiers[t].model,effort:p.tiers[t].effort}]))});
  return {enabled:c.enabled,classificationMaxChars:c.classificationMaxChars,disabledTiers:[...c.disabledTiers],
    routing:{codex:c.routing?.codex||'turn',hermes:c.routing?.hermes||'turn',claude:c.routing?.claude||'turn'},
    providers:Object.fromEntries(['codex','claude'].map(name=>[name,mapping(c.providers[name])])),
    variants:{codex:Object.fromEntries(Object.entries(c.variants?.codex||{}).map(([family,p])=>[family,mapping(p)]))}};
}
export class SettingsStore {
  constructor({file=configPath,catalog=loadModelCatalog}={}) {this.file=file;this.catalog=catalog;}
  read() {
    const text=fs.readFileSync(this.file,'utf8');
    const c=validateConfig(JSON.parse(text));
    const catalog=this.catalog();
    const models=(Array.isArray(catalog?.models)?catalog.models:[]).filter(m=>m && m.visibility!=='hide' && typeof m.slug==='string' && /^[a-zA-Z0-9._\-:\[\]]{1,120}$/.test(m.slug) && !m.slug.includes('jev-'))
      .map(m=>({id:m.slug,efforts:(Array.isArray(m.supported_reasoning_levels)?m.supported_reasoning_levels:[]).map(e=>e?.effort).filter(e=>typeof e==='string' && /^[a-z]{1,20}$/.test(e))}));
    return {revision:revision(text),settings:editableSettings(c),models,
      integrations:Object.fromEntries(['codex','hermes','claude'].map(n=>[n,c.clients[n]])),classifier:c.classifier?.provider||'typesafe'};
  }
  save(input) {
    keys(input,['revision','settings']);
    if(typeof input.revision!=='string' || !/^[a-f0-9]{64}$/.test(input.revision))fail('invalid_revision');
    const original=fs.readFileSync(this.file,'utf8');
    if(revision(original)!==input.revision)fail('settings_changed',409);
    const c=validateConfig(JSON.parse(original)),s=input.settings;
    const modelIds=c=>[...['codex','claude'].map(n=>c.providers[n]),...Object.values(c.variants?.codex||{})].map(p=>[p.fallbackModel,...tiers.map(t=>p.tiers[t].model)]);
    const previousModels=JSON.stringify(modelIds(c));
    if(!object(s)||!object(s.routing))fail('invalid_settings');
    keys(s,['enabled','classificationMaxChars','disabledTiers','routing','providers',...(Object.hasOwn(s,'variants')?['variants']:[])]);
    keys(s.routing,['codex','hermes',...(Object.hasOwn(s.routing,'claude')?['claude']:[])]);keys(s.providers,['codex','claude']);
    if(Object.hasOwn(s,'variants')){keys(s.variants,['codex']);keys(s.variants.codex,Object.keys(c.variants?.codex||{}));}
    const merge=(target,p)=>{
      keys(p,['fallbackModel','fallbackEffort','tiers']);keys(p.tiers,tiers);
      for(const t of tiers)keys(p.tiers[t],['model','effort']);
      target.fallbackModel=p.fallbackModel;target.fallbackEffort=p.fallbackEffort;
      for(const t of tiers)target.tiers[t]={...target.tiers[t],...p.tiers[t]};
    };
    for(const name of ['codex','claude'])merge(c.providers[name],s.providers[name]);
    for(const [family,p] of Object.entries(s.variants?.codex||{}))merge(c.variants.codex[family],p);
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
    const modelsChanged=previousModels!==JSON.stringify(modelIds(c));
    return {...this.read(),modelsChanged};
  }
}
