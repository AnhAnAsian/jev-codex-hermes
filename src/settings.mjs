import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {classifierProvider} from './classifier-client.mjs';
export const home = process.env.JEV_SERVICE_HOME || path.join(os.homedir(), '.config/jev-router');
export const configPath = path.join(home, 'config.json');
export const DEFAULT_MAX_PAYLOAD_BYTES = 128*1024*1024;
export function payloadLimit(config) {
  const limit=config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  if(!Number.isSafeInteger(limit) || limit<1024*1024 || limit>512*1024*1024)throw new Error('invalid_payload_limit');
  return limit;
}
export const labels = {haiku:'FAST', sonnet:'BALANCED', opus:'STRONG', fable:'LONG'};
export const internal = Object.fromEntries(Object.entries(labels).map(([k,v])=>[v,k]));
const realModel=model=>typeof model==='string' && /^[a-zA-Z0-9._\-:\[\]]{1,120}$/.test(model) && !model.includes('jev-') && model!=='jev-auto';
const effort=value=>value==null || ['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value);
export function validateConfig(c) {
  classifierProvider(c);
  payloadLimit(c);
  if(c.host!=='127.0.0.1')throw new Error('loopback_required');
  if(!Number.isInteger(c.port) || c.port<1024 || c.port>65535)throw new Error('invalid_port');
  if(typeof c.enabled!=='boolean' || !c.clients || ['codex','hermes','claude'].some(k=>typeof c.clients[k]!=='boolean'))throw new Error('invalid_clients');
  if(!Number.isInteger(c.classificationMaxChars) || c.classificationMaxChars<256 || c.classificationMaxChars>30000)throw new Error('invalid_classification_limit');
  if(!Array.isArray(c.disabledTiers) || c.disabledTiers.some(t=>!internal[t]))throw new Error('invalid_disabled_tiers');
  for(const mode of Object.values(c.routing||{}))if(!['conversation','turn'].includes(mode))throw new Error('invalid_routing_mode');
  for(const provider of ['codex','claude']) {
    const p=c.providers?.[provider];
    if(!p)throw new Error('missing_provider');
    const u=new URL(p.upstream);
    if(u.username || u.password || u.search || u.hash || u.protocol!=='https:')throw new Error('invalid_upstream');
    if(!realModel(p.fallbackModel) || !effort(p.fallbackEffort))throw new Error('invalid_fallback');
    if(Object.keys(p.tiers||{}).length!==4)throw new Error('invalid_tiers');
    for(const tier of Object.keys(internal)) {
      const spec=p.tiers?.[tier];
      if(!realModel(spec?.model) || !effort(spec.effort))throw new Error('invalid_tier');
    }
  }
  for(const [family,v] of Object.entries(c.variants?.codex||{})) {
    if(!['luna','sol'].includes(family) || !realModel(v.fallbackModel) || !v.fallbackModel.endsWith('-'+family) || !effort(v.fallbackEffort))throw new Error('invalid_variant_family');
    for(const tier of Object.keys(internal)) {
      const spec=v.tiers?.[tier];
      if(!realModel(spec?.model) || !spec.model.endsWith('-'+family) || !effort(spec.effort))throw new Error('invalid_variant_tier');
    }
  }
  return c;
}
export function readConfig() {
  // Validate the entire snapshot before mutating upstream's environment mappings.
  const c=validateConfig(JSON.parse(fs.readFileSync(configPath,'utf8')));
  for(const [provider,p] of Object.entries(c.providers))for(const [tier,s] of Object.entries(p.tiers)) {
    process.env[`JEV_${provider.toUpperCase()}_${tier}_MODEL`]=s.model;
    if(s.effort!=null)process.env[`JEV_${provider.toUpperCase()}_${tier}_EFFORT`]=s.effort;
    else delete process.env[`JEV_${provider.toUpperCase()}_${tier}_EFFORT`];
  }
  process.env.JEV_DISABLE_TIERS=c.disabledTiers.map(x=>internal[x]).join(',');
  delete process.env.JEV_DEBUG;delete process.env.JEV_DUMP;
  return c;
}
export function loadModelCatalog() {
  for(const p of [path.join(os.homedir(),'.codex/models_cache.json'),path.join(home,'desktop-models.json'),path.join(home,'codex-models.json')]) {
    try {const c=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(c.models)&&c.models.length)return c;}catch{}
  }
  return {models:[]};
}
export function loadKey(config=readConfig()) {
  const openrouter=classifierProvider(config)==='openrouter';
  if (openrouter ? !process.env.OPENROUTER_API_KEY : !process.env.JEV_API_KEY && !process.env.TYPESAFE_API_KEY) {
    for (const p of [path.join(home,'key.env'), path.join(os.homedir(),'.jev-router.env'), path.join(os.homedir(),'.jev-claude.env')]) {
      try { process.loadEnvFile(p); } catch {}
    }
  }
  return openrouter ? process.env.OPENROUTER_API_KEY : process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;
}
export function safeLog(entry) {
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  const allowed = ['client','tier','model','effort','confidence','latency_ms','state','status','served_model','transport','request_id','subagent','conversation_id','classifier_model','variant','payload_bytes','limit_bytes'];
  const d = {timestamp:new Date().toISOString()};
  for (const k of allowed) if (entry[k] !== undefined) d[k] = entry[k];
  const p=path.join(home,'decisions.jsonl');
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > 5_000_000) fs.renameSync(p,p+'.1');
    fs.appendFileSync(p, JSON.stringify(d)+'\n', {mode:0o600});
  } catch {}
}
