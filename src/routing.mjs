import {createHash,randomUUID} from 'node:crypto';
import {createClassifierClient} from './classifier-client.mjs';
import {QUESTIONS,THRESHOLDS,availableTiers,TIERS} from '../upstream/src/config.mjs';
import {decide,detectOverride as upstreamOverride,stripLengthHints} from '../upstream/src/policy.mjs';
import {newTurnPrompt,conversationKey,isAgentSession} from '../upstream/src/responses.mjs';
import {newTurnPrompt as claudePrompt,conversationKey as claudeKey,sessionOf,isSubagentSpawn,applyTier,sanitizeSchema} from '../upstream/src/proxy.mjs';
import {addJevModel} from '../upstream/src/codex-proxy.mjs';
import {labels,loadKey,safeLog} from './settings.mjs';
import {classificationMetadata} from './ui-metadata.mjs';

const variantFor=model=>({'gpt-jev-luna':'luna','gpt-jev-sol':'sol'})[model] || null;
const inFamily=(model,family)=>model?.endsWith('-'+family);
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const exactModel=prompt=>/^\s*(?:please\s+)?(?:use(?:\s+model\s*:)?|switch to)\s+(?:the\s+)?((?:gpt-|claude-)[a-z0-9.\-[\]]+)(?=$|[\s,:;])/i.exec(prompt||'')?.[1]?.toLowerCase() || null;
const detectOverride=prompt=>{
  const directive=/^\s*(?:please\s+)?(?:use|switch to)\s+(?:the\s+)?((?:gpt-|claude-)[a-z0-9.\-]+|haiku|sonnet|opus|luna|sol|fable|fast|balanced|strong|long|deep)(?:\s+(tier|model))?(?=$|[\s,:;])/i.exec(prompt||'');
  return directive?upstreamOverride('use '+directive[1]+(directive[2]?' '+directive[2]:'')):null;
};
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
  remember(set,key) {set.add(key);if(set.size>2000)set.delete(set.values().next().value);}
  async advice({prompt,provider='codex',disclosure}) {
    const config=this.config();
    const metadata=classificationMetadata(config);
    if(disclosure && (disclosure.classifier!==metadata.classifier || disclosure.classificationMaxChars!==metadata.classificationMaxChars))
      return {metadataChanged:true,...metadata,error:'Classification settings changed. Review the updated privacy notice, then ask again.'};
    if(!config.enabled)return {error:'Routing is disabled. Enable the router before asking Jev.'};
    const p=config.providers[provider],started=Date.now();
    const override=detectOverride(prompt),jev=override?null:await this.classifier(prompt,config);
    if(!jev && !override)return {error:'Jev is unavailable. Keep your current model and check jev-router doctor.'};
    // Advice has no active session/cache. Preserve upstream availability/override policy.
    const result=decide({prompt:override?prompt:'',jev,current:'opus',available:availableTiers(),contextTokens:0});
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
      const result=decide({prompt:override?prompt:'',jev,current:'opus',available:availableTiers(),contextTokens:0});
      const spec=p.tiers[labels[result.tier]];
      const decision={tier:labels[result.tier],model:spec.model,effort:spec.effort,confidence:jev?.confidence??null,state:result.reason};
      this.logger({client:'codex-desktop',...decision,latency_ms:Date.now()-started});
      return decision;
    })();
    this.hookTurns.set(key,pending);if(this.hookTurns.size>2000)this.hookTurns.delete(this.hookTurns.keys().next().value);
    return pending;
  }
  seedModels(catalog) {
    if(!Array.isArray(catalog?.models))return;
    const validated=new Map();
    for(const m of catalog.models) {
      if(typeof m?.slug!=='string' || !/^[a-zA-Z0-9._\-:\[\]]{1,120}$/.test(m.slug) || m.slug.includes('jev-'))continue;
      if(m.context_window!=null && (!Number.isFinite(m.context_window) || m.context_window<=0))continue;
      const levels=m.supported_reasoning_levels;
      if(levels!=null && (!Array.isArray(levels) || levels.some(x=>typeof x?.effort!=='string' || !/^[a-z][a-z0-9_-]{0,30}$/.test(x.effort))))continue;
      validated.set(m.slug,m);
    }
    if(validated.size)this.models=validated;
  }
  normalize(body,codex) {
    if(codex) {
      const info=this.models.get(body.model),levels=info?.supported_reasoning_levels?.map(x=>x.effort);
      if(levels?.length && body.reasoning?.effort && !levels.includes(body.reasoning.effort)) {
        body.reasoning.effort=levels.includes(info.default_reasoning_level)?info.default_reasoning_level:levels[0];
      }
    } else if(/^claude-haiku(?:$|-)/.test(body.model)) {
      const model=body.model;
      applyTier(body,'haiku'); // upstream strips thinking/context edits and unsupported effort
      body.model=model;
      if(body.output_config){delete body.output_config.effort;if(!Object.keys(body.output_config).length)delete body.output_config;}
    } else if(/^claude-(?:sonnet|opus)-5-5(?:$|-)/.test(body.model) && body.thinking) {
      const {budget_tokens,...thinking}=body.thinking;
      body.thinking={...thinking,type:'adaptive'};
    }
  }
  catalog(catalog) {
    this.seedModels(catalog);
    const result=addJevModel(structuredClone(catalog));
    const auto=result.models?.find(m=>m.slug==='jev-auto');
    if (auto) {
      const config=this.config(),profiles=[['gpt-jev-auto','Jev',config.providers.codex],
        ...['luna','sol'].filter(f=>config.variants?.codex?.[f]).map(f=>['gpt-jev-'+f,'Jev '+f[0].toUpperCase()+f.slice(1),config.variants.codex[f]])];
      const virtual=profiles.map(([slug,display_name,p],priority)=>{
        const windows=[...Object.values(p.tiers).map(s=>s.model),p.fallbackModel].map(id=>this.models.get(id)?.context_window).filter(Number.isFinite);
        return {...auto,slug,display_name,priority,visibility:'list',upgrade:null,
          description:'Jev routing profile; model and reasoning are configured in local settings.',
          ...(windows.length?{context_window:Math.min(...windows)}:{})};
      });
      // Keep the upstream CLI alias usable, but avoid a duplicate visible picker row.
      auto.visibility='hide';auto.description='Legacy Jev CLI alias.';
      result.models=[...virtual,...result.models.filter(m=>!['gpt-jev-auto','gpt-jev-luna','gpt-jev-sol'].includes(m.slug))];
    }
    return result;
  }
  async rewrite(body,provider,client,headers={},connectionKey='') {
    const codex=provider==='codex';
    // Transport metadata is used for identity only and is never forwarded into
    // the body. Authentication and account header values are never inspected.
    const identity=codex ? {...body,client_metadata:{...body.client_metadata,
      thread_id:body.client_metadata?.thread_id || headers.session_id || headers['x-session-id'] || connectionKey || undefined}} : body;
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
      if(prompt && state) this.remember(this.manual,key);
      return {body,receipt:{...receipt,state:'manual'}};
    }
    const fallback=state?.spec || {model:p.fallbackModel,effort:p.fallbackEffort};
    const applySpec=spec=>{
      body.model=spec.model;
      if(codex && spec.effort)body.reasoning={...body.reasoning,effort:spec.effort};
      else if(!codex && spec.effort)body.output_config={...body.output_config,effort:spec.effort};
      this.normalize(body,codex);
    };
    if (!config.enabled || !config.clients[client]) {
      applySpec({model:p.fallbackModel,effort:p.fallbackEffort});
      return {body,receipt:{...receipt,model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null,state:'disabled'}};
    }
    const agentTools=(Array.isArray(body.tools) && body.tools.length>0) || body.input?.some(item=>item.type==='additional_tools');
    if(codex && !state?.lastFingerprint && (!isAgentSession(identity) || !agentTools)) {
      applySpec({model:p.fallbackModel,effort:p.fallbackEffort});
      return {body,receipt:{...receipt,model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null,state:'auxiliary'}};
    }
    if(!codex)body.tools?.forEach(t=>sanitizeSchema(t.input_schema));
    if(!codex && session)this.remember(this.routedSessions,session);
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
      const decision=decide({prompt:override?prompt:'',jev,current,available,contextTokens:policyContextTokens,cheapStreak:s.cheapStreak});
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
      if(subagent && !codex)this.remember(this.subagents,key);
    }
    applySpec(s.spec);
    const final={...receipt,tier:labels[s.tier],model:body.model,effort:body.reasoning?.effort ?? body.output_config?.effort ?? null,
      confidence:jev?.confidence ?? null,latency_ms:elapsed,state:reason};
    this.logger(final);
    return {body,receipt:final};
  }
}
