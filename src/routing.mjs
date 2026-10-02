import {createHash,randomUUID} from 'node:crypto';
import {createClassifierClient} from './classifier-client.mjs';
import {QUESTIONS,THRESHOLDS,availableTiers,TIERS} from '../upstream/src/config.mjs';
import {decide,detectOverride,stripLengthHints} from '../upstream/src/policy.mjs';
import {newTurnPrompt,conversationKey,isAgentSession} from '../upstream/src/responses.mjs';
import {newTurnPrompt as claudePrompt,conversationKey as claudeKey,sessionOf,isSubagentSpawn,applyTier,sanitizeSchema} from '../upstream/src/proxy.mjs';
import {applyCodexTier,addJevModel} from '../upstream/src/codex-proxy.mjs';
import {labels,loadKey,safeLog} from './settings.mjs';

const variantFor=model=>({'gpt-jev-luna':'luna','gpt-jev-sol':'sol'})[model] || null;
const inFamily=(model,family)=>model?.endsWith('-'+family);
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const exactModel=prompt=>/\b(?:use|switch to|with|on)\s+(?:the\s+)?((?:gpt-|claude-)[a-z0-9.\-[\]]+)\b/i.exec(prompt||'')?.[1] || null;
export async function classify(prompt,config) {
  const key=loadKey(config);
  if (!key) return null;
  // Keep upstream's exact classifier question, stripping, SDK, retries and deadline;
  // disable the SDK's own logger so exceptions can never print request data.
  const limit=config.classificationMaxChars || 8000;
  const text=stripLengthHints(prompt);
  const request=text.length>limit ? text.slice(0,Math.floor(limit*0.75))+'\n[omitted middle]\n'+text.slice(-Math.floor(limit*0.25)) : text;
  const started=Date.now();
  try {
    const client=createClassifierClient(config,key);
    client.logger={debug(){},info(){},warn(){},error(){}};
    const r=await client.systemOne({state:{request},questions:QUESTIONS},{signal:AbortSignal.timeout(THRESHOLDS.jevDeadlineMs)});
    const answer=r?.answers?.model_tier;
    if (!TIERS.some(t=>t.name===answer?.choice) || !Number.isFinite(answer?.confidence)) return null;
    return {...answer,ms:Date.now()-started,classifier_model:r.model??null};
  } catch { return null; }
}

export class RoutingEngine {
  constructor({config,classifier=classify,logger=safeLog}={}) {
    this.config=config;this.classifier=classifier;this.logger=logger;
    this.states=new Map();this.routedSessions=new Set();this.subagents=new Set();this.manual=new Set();
    this.models=new Map();this.locks=new Map();
    this.hookTurns=new Map();
  }
  async advice({prompt,provider='codex'}) {
    const config=this.config();
    if(!config.enabled)return {error:'Routing is disabled. Enable the router before asking Jev.'};
    const p=config.providers[provider],started=Date.now();
    const override=detectOverride(prompt),jev=override?null:await this.classifier(prompt,config);
    if(!jev && !override)return {error:'Jev is unavailable. Keep your current model and check jev-router doctor.'};
    // Advice has no active session/cache. Preserve upstream availability/override policy.
    const result=decide({prompt,jev,current:'opus',available:availableTiers(),contextTokens:0});
    const spec=p.tiers[labels[result.tier]];
    const advice={tier:labels[result.tier],model:spec.model,effort:spec.effort,
      confidence:jev?.confidence??null,latency_ms:Date.now()-started,classifier_model:jev?.classifier_model??null};
    this.logger({client:'advice-'+provider,...advice,state:override?'manual-advice':'jev-advice'});
    return {advice};
  }
  async desktopDecision({prompt,session_id,turn_id,model}) {
    const config=this.config();
    if((config.desktop?.mode && config.desktop.mode!=='hook-subagent') || !config.enabled || !config.clients.codex || !prompt || model==='jev-auto')return null;
    if(model && !config.desktop?.defaultModels?.includes(model))return null;
    if(exactModel(prompt))return null; // explicit model choice remains the client's job
    const key=hash(JSON.stringify([session_id,turn_id||prompt]));
    if(this.hookTurns.has(key))return this.hookTurns.get(key);
    const pending=(async()=>{
      const p=config.providers.codex;
      const override=detectOverride(prompt);
      const started=Date.now();
      const jev=override?null:await this.classifier(prompt,config);
      if(!jev && !override) {this.logger({client:'codex-desktop',state:'jev-unavailable',latency_ms:Date.now()-started});return null;}
      const result=decide({prompt,jev,current:'opus',available:availableTiers(),contextTokens:0});
      const spec=p.tiers[labels[result.tier]];
      const decision={tier:labels[result.tier],model:spec.model,effort:spec.effort,confidence:jev?.confidence??null,state:result.reason};
      this.logger({client:'codex-desktop',...decision,latency_ms:Date.now()-started});
      return decision;
    })();
    this.hookTurns.set(key,pending);if(this.hookTurns.size>2000)this.hookTurns.delete(this.hookTurns.keys().next().value);
    return pending;
  }
  catalog(catalog) {
    for (const m of catalog.models || []) this.models.set(m.slug,m);
    const result=addJevModel(catalog);
    const auto=result.models?.find(m=>m.slug==='jev-auto');
    if (auto) {
      const windows=Object.values(this.config().providers.codex.tiers).map(s=>this.models.get(s.model)?.context_window).filter(Number.isFinite);
      if (windows.length) auto.context_window=Math.min(...windows);
      auto.description='Automatic Jev routing; TypeSafe receives the latest task text.';
    }
    return result;
  }
  async rewrite(body,provider,client,headers={},connectionKey='') {
    const codex=provider==='codex';
    // Transport metadata is used for identity only and is never forwarded into
    // the body. Authentication and account header values are never inspected.
    const identity=codex ? {...body,client_metadata:{...body.client_metadata,
      thread_id:body.client_metadata?.thread_id || headers.session_id || headers['x-session-id'] || (!body.prompt_cache_key ? connectionKey : '') || undefined}} : body;
    const variant=codex?variantFor(body.model):null;
    const key=client+':'+(codex ? conversationKey(identity) : claudeKey(body,headers))+(variant?':'+variant:'');
    const before=this.locks.get(key) || Promise.resolve();
    const task=before.catch(()=>{}).then(()=>this._rewrite(body,identity,provider,client,headers,key));
    this.locks.set(key,task);
    try {return await task;} finally {if(this.locks.get(key)===task)this.locks.delete(key);}
  }
  async _rewrite(body,identity,provider,client,headers,key) {
    const config=this.config(),codex=provider==='codex',variant=codex?variantFor(body.model):null;
    const p=variant?{...config.providers[provider],...config.variants.codex[variant]}:config.providers[provider];
    const receipt={client,...(variant?{variant}:{}),request_id:randomUUID(),conversation_id:hash(key).slice(0,16),model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null};
    const prompt=codex ? newTurnPrompt(body) : claudePrompt(body);
    const session=codex ? '' : sessionOf(body,headers);
    const state=this.states.get(key);
    const subagent=codex ? Boolean(body.client_metadata?.['x-openai-subagent'] || headers['x-openai-subagent']) :
      this.subagents.has(key) || (Boolean(session) && isSubagentSpawn({session,key,routedSessions:this.routedSessions,convos:this.states,prompt,manual:this.manual}));
    receipt.subagent=subagent;
    const automatic=body.model==='jev-auto' || (codex && (body.model==='gpt-jev-auto' || variant)) || (!codex && subagent);
    if (!automatic) {
      if(prompt && state) this.manual.add(key);
      return {body,receipt:{...receipt,state:'manual'}};
    }
    const fallback=state?.spec || {model:p.fallbackModel,effort:p.fallbackEffort};
    const applySpec=spec=>{
      body.model=spec.model;
      if(codex && spec.effort)body.reasoning={...body.reasoning,effort:spec.effort};
      else if(!codex && spec.effort)body.output_config={...body.output_config,effort:spec.effort};
    };
    if (!config.enabled || !config.clients[client]) {
      applySpec({model:p.fallbackModel,effort:p.fallbackEffort});
      return {body,receipt:{...receipt,model:body.model,effort:p.fallbackEffort,state:'disabled'}};
    }
    const agentTools=(Array.isArray(body.tools) && body.tools.length>0) || body.input?.some(item=>item.type==='additional_tools');
    if(codex && (!isAgentSession(identity) || !agentTools)) {
      applySpec({model:p.fallbackModel,effort:p.fallbackEffort});
      return {body,receipt:{...receipt,model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null,state:'auxiliary'}};
    }
    if(!codex)body.tools?.forEach(t=>sanitizeSchema(t.input_schema));
    if(!codex && session)this.routedSessions.add(session);
    let s=state || {spec:fallback,tier:'opus',cheapStreak:0,lastFingerprint:null};
    this.states.set(key,s);
    if(this.states.size>2000)this.states.delete(this.states.keys().next().value);
    const conversationPinned=config.routing?.[client]==='conversation' && Boolean(s.lastFingerprint);
    let tier=s.tier,reason=conversationPinned?'conversation-pinned':'pinned',jev=null,elapsed=0;
    const messages=codex ? body.input : body.messages;
    const count=(messages||[]).filter(m=>m.role==='user').length;
    // Hashes remain in memory only. Retry requests are pinned without another
    // classifier call; full transcripts distinguish identical subsequent tasks.
    const turnTag=body.client_metadata?.['x-codex-turn-metadata'] || headers['x-codex-turn-metadata'] || '';
    const fingerprint=prompt ? hash(JSON.stringify([prompt,count,turnTag])) : null;
    if(prompt && fingerprint!==s.lastFingerprint && (!conversationPinned || detectOverride(prompt) || exactModel(prompt))) {
      const started=Date.now();
      const current=s.tier;
      const available=availableTiers().filter(t=>!codex || this.models.size===0 || this.models.has(p.tiers[labels[t]].model));
      const contextTokens=Math.round(JSON.stringify(messages).length/4);
      // Check upstream's explicit override before calling Jev.
      const override=detectOverride(prompt);
      const exact=exactModel(prompt);
      jev=(override || exact) ? null : await this.classifier(prompt,config);
      elapsed=Date.now()-started;
      // A new virtual-model conversation has no established routed-model cache yet.
      const policyContextTokens=s.lastFingerprint?contextTokens:0;
      const decision=decide({prompt,jev,current,available,contextTokens:policyContextTokens,cheapStreak:s.cheapStreak});
      tier=decision.tier;reason=decision.reason;s.cheapStreak=decision.cheapStreak;
      let spec=(jev || override) ? p.tiers[labels[tier]] : fallback;
      if(exact && (!variant || inFamily(exact,variant))){spec={model:exact,effort:body.reasoning?.effort ?? body.output_config?.effort ?? fallback.effort};reason='explicit-model';}
      else if(exact && variant)reason='family-restricted-model';
      // An incremental WebSocket chain may omit history. Do not change models
      // underneath a server-side previous_response_id whose history we lack.
      if(body.previous_response_id && spec.model!==s.spec.model) {spec=s.spec;tier=s.tier;reason='previous-response-chain-pinned';}
      const window=codex && this.models.get(spec.model)?.context_window;
      if(window && contextTokens>window*0.9) {spec=fallback;tier=s.tier;reason='context-capacity-fallback';}
      s.spec=spec;s.tier=tier;s.lastFingerprint=fingerprint;
      if(subagent && !codex)this.subagents.add(key);
    }
    // Use upstream capability conversion only when the selected specification
    // is a tier. On classifier failure the client's original default is kept.
    const tierTarget=p.tiers[labels[s.tier]];
    if(!variant && s.spec.model===tierTarget.model && s.spec.effort===tierTarget.effort) {
      if(codex)applyCodexTier(body,s.tier,this.models);else applyTier(body,s.tier);
    } else applySpec(s.spec);
    if(!codex && /^claude-(?:sonnet|opus)-5-5(?:$|-)/.test(body.model)) {
      // 5.5 rejects disabled/manual-budget thinking. Adaptive also permits
      // tier effort to vary per turn, unlike between_tools.
      if(body.thinking && body.thinking.type!=='adaptive') {
        const {budget_tokens,...thinking}=body.thinking;
        body.thinking={...thinking,type:'adaptive'};
      }
    }
    const final={...receipt,tier:labels[s.tier],model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null,
      confidence:jev?.confidence ?? null,latency_ms:elapsed,state:reason};
    this.logger(final);
    return {body,receipt:final};
  }
}
