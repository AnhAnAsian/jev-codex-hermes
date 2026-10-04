#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';

const state=process.env.JEV_SERVICE_HOME || path.join(os.homedir(),'.config/jev-router');
let installation;
try {installation=JSON.parse(fs.readFileSync(process.env.JEV_NATIVE_SETTINGS_FILE || path.join(state,'native-desktop.json'),'utf8'));}
catch {process.stderr.write('Jev native adapter is not configured. Restore the Desktop runtime override.\n');process.exit(1);}
const real=installation.realCli,args=process.argv.slice(2),index=args.indexOf('app-server');
const utility=['generate-ts','generate-json-schema','daemon','proxy','help'].includes(args[index+1]) || args.includes('--help') || args.includes('-h');
const bridged=index>=0 && !utility && !args.some(x=>x.startsWith('ws://') || x.startsWith('unix://'));
const env={...process.env,CODEX_CLI_PATH:real};
if(!bridged) {
  const child=spawn(real,args,{stdio:'inherit',env});
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{process.stderr.write('Native Codex runtime is unavailable.\n');process.exit(1);});
  child.on('exit',code=>process.exit(code??1));
} else {
  const {NativeRouting,LineObserver,internalId}=await import('./src/native-routing.mjs');
  const {readConfig,safeLog}=await import('./src/settings.mjs');
  const legacyPins=new Map();
  for(const name of ['decisions.jsonl.1','decisions.jsonl'])try {
    const file=path.join(state,name);if(fs.statSync(file).size>10*1024*1024)continue;
    for(const line of fs.readFileSync(file,'utf8').split('\n'))try {
      const receipt=JSON.parse(line);
      if(receipt.state==='served' && receipt.conversation_id && receipt.served_model) {
        legacyPins.set(receipt.conversation_id,{model:receipt.served_model,effort:receipt.effort});
        if(legacyPins.size>2000)legacyPins.delete(legacyPins.keys().next().value);
      }
    }catch{}
  }catch{}
  const defaults=JSON.parse(fs.readFileSync(new URL('./config.example.json',import.meta.url),'utf8'));
  const configuration=()=>{try{return readConfig();}catch{return {...defaults,enabled:false};}};
  const router=new NativeRouting({legacyPins,config:configuration}),internal=new Map();
  const nativeArgs=[...args,'-c','model_provider="openai"','-c','model_catalog_json='+JSON.stringify(installation.realCatalog)];
  const child=spawn(real,nativeArgs,{stdio:['pipe','pipe','inherit'],env});
  const write=message=>child.stdin.write(JSON.stringify(message)+'\n');
  const callNative=(method,params)=>new Promise((resolve,reject)=>{
    const id=internalId(),timer=setTimeout(()=>{internal.delete(id);reject(Error('Native metadata query timed out'));},5000);
    timer.unref();internal.set(id,{resolve,reject,timer});write({id,method,params});
  });
  const output=new LineObserver({inspect:message=>{
    if(typeof message.id==='string' && message.id.startsWith('jev-native:')) {
      const pending=internal.get(message.id);
      if(pending){internal.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error('Native metadata query unavailable')):pending.resolve(message.result);}
      return null;
    }
    return router.observe(message);
  },afterInspect:message=>router.notificationsAfter(message),emit:chunk=>{if(!process.stdout.write(chunk))child.stdout.pause();}});
  process.stdout.on('drain',()=>child.stdout.resume());
  child.stdout.on('data',chunk=>output.feed(chunk));
  child.on('error',()=>{process.stderr.write('Native Codex runtime is unavailable.\n');process.exit(1);});
  child.stdin.on('error',()=>{});
  child.on('exit',code=>process.exit(code??1));
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>child.kill(signal));
  const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  const pendingInput=new Set();let ended=false;
  input.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return child.stdin.write(line+'\n');}
    const job=router.rewrite(message,callNative).then(write).catch(error=>{
      // Never print or log request parameters, prompts, auth or exception objects.
      safeLog({client:'codex-native',state:'native-routing-error'});
      if(error.code===-32800)process.stdout.write(JSON.stringify({id:message.id,error:{code:-32800,message:'Chat cancelled before routing completed'}})+'\n');
      else {
        const output=structuredClone(message),model=output.params?.collaborationMode?.settings?.model || output.params?.model;
        if(['jev-auto','gpt-jev-auto','gpt-jev-luna','gpt-jev-sol'].includes(model)) {
          const spec=router.fallback(model);output.params.model=spec.model;
          if(output.params.collaborationMode?.settings)output.params.collaborationMode.settings.model=spec.model;
        }
        write(output);
      }
    }).finally(()=>{pendingInput.delete(job);if(ended && !pendingInput.size)child.stdin.end();});
    pendingInput.add(job);
  });
  input.on('close',()=>{ended=true;if(!pendingInput.size)child.stdin.end();});
  safeLog({client:'codex-native',state:'native-adapter-started'});
}
