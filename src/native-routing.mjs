// Route human chat-start input, never the provider's conversation history.
import {createHash,randomUUID} from 'node:crypto';
import {RoutingEngine} from './routing.mjs';
import {readConfig,loadModelCatalog,safeLog} from './settings.mjs';

export const virtualModel=model=>['jev-auto','gpt-jev-auto','gpt-jev-luna','gpt-jev-sol'].includes(model);
const family=model=>({'gpt-jev-luna':'luna','gpt-jev-sol':'sol'})[model];
export function receiptKey(threadId) {
  const key=createHash('sha1').update(threadId).digest('hex').slice(0,12);
  return createHash('sha256').update('codex:'+key).digest('hex').slice(0,16);
}
const requestedModel=params=>params?.collaborationMode?.settings?.model ?? params?.model ?? params?.config?.model;
function select(params,spec) {
  params.model=spec.model;
  if(spec.effort)params.effort=spec.effort;
  if(params.collaborationMode?.settings) {
    params.collaborationMode.settings.model=spec.model;
    if(spec.effort)params.collaborationMode.settings.reasoning_effort=spec.effort;
  }
}

export class NativeRouting {
  constructor({config=readConfig,classifier,catalog=loadModelCatalog,logger=safeLog,legacyPins=new Map()}={}) {
    this.configSource=config;this.snapshot=structuredClone(config());this.logger=logger;
    this.config=()=>{try{this.snapshot=structuredClone(this.configSource());}catch{}return this.snapshot;};
    this.engine=new RoutingEngine({config:this.config,classifier,logger});
    this.engine.seedModels(catalog());this.threads=new Map();this.requests=new Map();this.legacyPins=legacyPins;
    this.locks=new Map();this.pendingTurns=new Map();this.displaySettings=new Map();this.routedThreads=new Set();
  }
  fallback(profile) {
    const c=this.config(),p=family(profile)?c.variants?.codex?.[family(profile)]:c.providers.codex;
    return {model:p?.fallbackModel || c.providers.codex.fallbackModel,effort:p?.fallbackEffort || c.providers.codex.fallbackEffort};
  }
  remember(id,state) {
    this.threads.set(id,state);
    if(this.threads.size>2000) {
      const oldest=this.threads.keys().next().value;
      this.threads.delete(oldest);this.displaySettings.delete(oldest);this.routedThreads.delete(oldest);
    }
  }
  catalog(data) {
    if(!Array.isArray(data))return data;
    const template=data.find(m=>m.model==='gpt-6.1-sol');if(!template)return data;
    const c=this.config(),profiles=[['gpt-jev-auto','Jev'],...['luna','sol'].filter(f=>c.variants?.codex?.[f]).map(f=>['gpt-jev-'+f,'Jev '+f[0].toUpperCase()+f.slice(1)])];
    return [...profiles.map(([model,displayName])=>({...template,id:model,model,displayName,hidden:false,isDefault:false,upgrade:null,upgradeInfo:null,availabilityNux:null,
      description:'Jev chooses once before the first model request. Codex then connects directly using the selected real model.'})),...data.filter(m=>!virtualModel(m.model))];
  }
  observe(message) {
    if(message.method==='thread/settings/updated' && message.params?.threadId) {
      const {threadId,threadSettings}=message.params;
      if(threadSettings?.modelProvider==='openai' && threadSettings.collaborationMode?.settings && !virtualModel(threadSettings.model)) {
        this.displaySettings.set(threadId,structuredClone(message));
        if(this.displaySettings.size>2000)this.displaySettings.delete(this.displaySettings.keys().next().value);
      } else this.displaySettings.delete(threadId);
    }
    const pending=this.requests.get(message.id);
    if(pending) {
      this.requests.delete(message.id);
      if(!message.error && message.result) {
        if(pending.kind==='models')message.result.data=this.catalog(message.result.data);
        else if(message.result.thread?.id) {
          this.remember(message.result.thread.id,{profile:pending.profile,spec:pending.spec,
            ready:pending.ready,provider:message.result.modelProvider || message.result.thread.modelProvider});
        } else if(pending.kind==='settings')this.remember(pending.threadId,pending.state);
      }
    }
    return message;
  }
  notificationsAfter(message) {
    // Desktop's turn/started handler restores its optimistic turn parameters,
    // including the Jev alias. Replay confirmed native settings AFTER that
    // event so its model picker reflects the real model and effort again.
    const threadId=message.params?.threadId;
    if(message.method!=='turn/started' || !this.routedThreads.has(threadId))return [];
    const settings=this.displaySettings.get(threadId);
    return settings?[structuredClone(settings)]:[];
  }
  async rewrite(message,callNative=async()=>null) {
    const method=message.method,params=message.params;
    if(!params || !method || message.id==null)return message;
    if(method==='model/list') {this.requests.set(message.id,{kind:'models'});return message;}
    if(method==='turn/interrupt') {
      const pending=this.pendingTurns.get(params.threadId);if(pending)pending.cancelled=true;
      return message;
    }
    if(['thread/start','thread/resume','thread/fork'].includes(method)) {
      let saved;
      if(params.threadId && !params.history) {
        try {saved=(await callNative('thread/read',{threadId:params.threadId,includeTurns:false}))?.thread;}catch{}
      }
      // Preserve native precedence and saved settings when metadata is unavailable.
      // Desktop commonly supplies both threadId and its matching rollout path.
      if(params.path && saved?.path && params.path!==saved.path)return message;
      if(method!=='thread/start' && !saved && !requestedModel(params))return message;
      const provider=params.modelProvider || params.config?.model_provider || saved?.modelProvider;
      // Non-Codex providers remain under their original client's control.
      if(provider && !['openai','jev'].includes(provider))return message;
      let requested=requestedModel(params) || saved?.model;
      let spec,profile,ready=true;
      if(virtualModel(requested)) {
        profile=requested;
        const pin=saved && this.legacyPins.get(receiptKey(params.threadId));
        if(saved?.model && !virtualModel(saved.model)) {
          spec={model:saved.model,effort:params.config?.model_reasoning_effort ?? saved.reasoningEffort};ready=true;
        }
        else if(pin && this.engine.models.has(pin.model)){spec=pin;ready=true;}
        else {spec=this.fallback(profile);ready=false;}
      } else if(requested)spec={model:requested,effort:params.config?.model_reasoning_effort || saved?.reasoningEffort};
      else spec=null;
      const output=structuredClone(message);output.params.modelProvider='openai';
      if(spec)output.params.model=spec.model;
      if(spec && virtualModel(output.params.config?.model))output.params.config.model=spec.model;
      if(spec?.effort && output.params.config?.model_reasoning_effort==null) {
        output.params.config={...output.params.config,model_reasoning_effort:spec.effort};
      }
      if(output.params.config?.model_provider==='jev')output.params.config.model_provider='openai';
      this.requests.set(message.id,{kind:'thread',profile,spec,ready});
      return output;
    }
    if(method==='thread/settings/update') {
      const model=requestedModel(params);if(!model)return message;
      const previous=this.threads.get(params.threadId);
      if(previous?.provider && previous.provider!=='openai')return message;
      const profile=virtualModel(model)?model:null;
      const output=profile?structuredClone(message):message;
      const ready=profile && previous?.profile===profile && previous.ready;
      const spec=profile?(ready?previous.spec:this.fallback(profile)):{model,effort:params.effort};
      if(profile)select(output.params,spec);
      this.requests.set(message.id,{kind:'settings',threadId:params.threadId,state:{profile,spec,ready:profile?Boolean(ready):true,provider:'openai'}});
      return output;
    }
    if(method!=='turn/start')return message;
    const threadId=params.threadId,prior=this.locks.get(threadId) || Promise.resolve();
    const work=prior.catch(()=>{}).then(()=>this.startTurn(message));this.locks.set(threadId,work);
    try {
      const output=await work;
      if(output!==message)this.routedThreads.add(threadId);
      return output;
    } finally{if(this.locks.get(threadId)===work)this.locks.delete(threadId);}
  }
  async startTurn(message) {
    const params=message.params,threadId=params.threadId,previous=this.threads.get(threadId);
    if(previous?.provider && previous.provider!=='openai')return message;
    const requested=requestedModel(params);
    const profile=virtualModel(requested)?requested:previous?.profile && !previous.ready && (!requested || requested===previous.spec?.model)?previous.profile:null;
    if(!profile)return message;
    const output=structuredClone(message);
    let spec=previous?.profile===profile && previous.ready?previous.spec:null;
    if(!spec) {
      // Native turn/start contains only the new human input, not model history.
      const prompt=(params.input || []).filter(x=>x.type==='text').map(x=>x.text).join('\n');
      const token={cancelled:false};this.pendingTurns.set(threadId,token);
      try {
        const result=await this.engine.rewrite({model:profile,client_metadata:{thread_id:threadId},
          input:[{role:'user',content:prompt}],tools:[{type:'function',name:'native_chat'}],
          reasoning:{effort:params.effort || params.collaborationMode?.settings?.reasoning_effort}},'codex','codex');
        spec={model:result.body.model,effort:result.body.reasoning?.effort};
      } catch {spec=this.fallback(profile);}
      finally {if(this.pendingTurns.get(threadId)===token)this.pendingTurns.delete(threadId);}
      if(token.cancelled) {
        const key=createHash('sha1').update(threadId).digest('hex').slice(0,12);
        this.engine.states.delete('codex:'+key+(family(profile)?':'+family(profile):''));
        throw Object.assign(new Error('Chat cancelled before routing completed'),{code:-32800});
      }
      const current=this.threads.get(threadId);
      if(current && current!==previous && current.ready && !current.profile) {
        // A picker choice made while classification was in flight wins.
        select(output.params,current.spec);return output;
      }
      this.logger({client:'codex-native',state:'native-first-request',model:spec.model,effort:spec.effort,
        conversation_id:receiptKey(threadId)});
      this.remember(threadId,{profile,spec,ready:true,provider:'openai'});
    }
    select(output.params,spec);
    return output;
  }
}

// Native events can be huge. Only inspect small response lines; stream larger
// lines without collecting them. Internal metadata queries are small by design.
export class LineObserver {
  constructor({maxBytes=262144,inspect=x=>x,afterInspect=()=>[],emit=x=>{}}={}) {
    this.maxBytes=maxBytes;this.inspect=inspect;this.afterInspect=afterInspect;this.emit=emit;this.parts=[];this.bytes=0;this.streaming=false;
  }
  feed(chunk) {
    let start=0;
    for(let end;(end=chunk.indexOf(10,start))>=0;) {this.part(chunk.subarray(start,end),true);start=end+1;}
    if(start<chunk.length)this.part(chunk.subarray(start),false);
  }
  part(chunk,end) {
    if(this.streaming)this.emit(chunk);
    else if(this.bytes+chunk.length>this.maxBytes) {
      for(const part of this.parts)this.emit(part);this.parts=[];this.bytes=0;
      this.streaming=true;this.emit(chunk);
    } else {this.parts.push(chunk);this.bytes+=chunk.length;}
    if(!end)return;
    if(this.streaming)this.emit(Buffer.from('\n'));
    else {
      const line=Buffer.concat(this.parts);let replacement=line,following=[];
      try {const original=JSON.parse(line.toString());const result=this.inspect(original);
        replacement=result==null?null:Buffer.from(JSON.stringify(result));
        if(result!=null)following=this.afterInspect(result);
      }catch{}
      if(replacement!=null){this.emit(replacement);this.emit(Buffer.from('\n'));}
      for(const message of following){this.emit(Buffer.from(JSON.stringify(message)));this.emit(Buffer.from('\n'));}
    }
    this.parts=[];this.bytes=0;this.streaming=false;
  }
}

export const internalId=()=> 'jev-native:'+randomUUID();
