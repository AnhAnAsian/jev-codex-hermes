import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {classifierProvider} from './classifier-client.mjs';
export const home = process.env.JEV_SERVICE_HOME || path.join(os.homedir(), '.config/jev-router');
export const configPath = path.join(home, 'config.json');
export const labels = {haiku:'FAST', sonnet:'BALANCED', opus:'STRONG', fable:'LONG'};
export const internal = Object.fromEntries(Object.entries(labels).map(([k,v])=>[v,k]));
export function readConfig() {
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  classifierProvider(c);
  if (c.host !== '127.0.0.1') throw new Error('loopback_required');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw new Error('invalid_port');
  for (const [provider,p] of Object.entries(c.providers)) {
    const u = new URL(p.upstream);
    if (u.username || u.password || u.search || u.hash || u.protocol !== 'https:') throw new Error('invalid_upstream');
    if (!p.fallbackModel || p.fallbackModel === 'jev-auto') throw new Error('invalid_fallback');
    for (const [tier,s] of Object.entries(p.tiers)) {
      if (!internal[tier] || !s.model) throw new Error('invalid_tier');
      process.env[`JEV_${provider.toUpperCase()}_${tier}_MODEL`] = s.model;
      if (s.effort != null) process.env[`JEV_${provider.toUpperCase()}_${tier}_EFFORT`] = s.effort;
      else delete process.env[`JEV_${provider.toUpperCase()}_${tier}_EFFORT`];
    }
  }
  for(const [family,v] of Object.entries(c.variants?.codex || {})) {
    if(!['luna','sol'].includes(family) || !v.fallbackModel?.endsWith('-'+family))throw new Error('invalid_variant_family');
    for(const tier of Object.keys(internal)) {
      const spec=v.tiers?.[tier];
      if(!spec?.model?.endsWith('-'+family) || !['low','medium','high','xhigh'].includes(spec.effort))throw new Error('invalid_variant_tier');
    }
  }
  process.env.JEV_DISABLE_TIERS = (c.disabledTiers || []).map(x=>internal[x] || x).join(',');
  delete process.env.JEV_DEBUG; delete process.env.JEV_DUMP;
  return c;
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
  const allowed = ['client','tier','model','effort','confidence','latency_ms','state','status','served_model','transport','request_id','subagent','conversation_id','classifier_model','variant'];
  const d = {timestamp:new Date().toISOString()};
  for (const k of allowed) if (entry[k] !== undefined) d[k] = entry[k];
  const p=path.join(home,'decisions.jsonl');
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > 5_000_000) fs.renameSync(p,p+'.1');
    fs.appendFileSync(p, JSON.stringify(d)+'\n', {mode:0o600});
  } catch {}
}
