#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {terminalServer} from './src/native-terminal.mjs';
import {firstRequest} from './src/first-request.mjs';
import {NativeRouting,virtualModel} from './src/native-routing.mjs';
import {readConfig} from './src/settings.mjs';

const state=process.env.JEV_SERVICE_HOME || path.join(os.homedir(),'.config/jev-router');
const settings=process.env.JEV_TERMINAL_SETTINGS_FILE || path.join(state,'native-terminal.json');
let install;try{install=JSON.parse(fs.readFileSync(settings,'utf8'));}catch{process.stderr.write('Native terminal integration is not configured.\n');process.exit(1);}
let args=process.argv.slice(2),cleanup=()=>{};
function launch(argv,stdio='inherit') {
  const child=spawn(install.realCli,argv,{stdio,env:{...process.env,CODEX_CLI_PATH:install.realCli}});
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{cleanup();process.stderr.write('Codex executable unavailable.\n');process.exit(1);});
  child.on('exit',code=>{cleanup();process.exit(code??1);});return child;
}
const config=spawnSync(install.python,[new URL('./native-cli-config.py',import.meta.url).pathname,JSON.stringify(args)],{encoding:'utf8'});
if(config.status!==0){process.stderr.write('Cannot resolve terminal configuration safely.\n');process.exit(1);}
const selected=JSON.parse(config.stdout),command=selected.command;
const bypass=args.some(x=>['--help','-h','--version','-V','--oss','--remote','--local-provider'].includes(x) || x.startsWith('--remote=') || x.startsWith('--local-provider=')) || !['openai','jev'].includes(selected.provider) || selected.customHome;
const utilities=command && !['exec','e','resume','fork','review','app-server'].includes(command);
if(bypass || utilities){launch(args);}
else if(command==='app-server') {
  const child=spawn(process.execPath,[new URL('./native-codex.mjs',import.meta.url).pathname,...args],
    {stdio:'inherit',env:{...process.env,JEV_NATIVE_SETTINGS_FILE:settings}});
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>child.kill(signal));
  child.on('exit',code=>process.exit(code??1));
  child.on('error',()=>{process.stderr.write('Native adapter unavailable.\n');process.exit(1);});
}
else if(command==='exec' || command==='e' || command==='review') {
  let spec={model:selected.model,effort:selected.effort},stdin;
  const resumed=selected.isResume;
  if(resumed && !selected.explicitModel) {
    spec={model:selected.savedModel || selected.model,effort:selected.savedEffort || selected.effort};
    if(virtualModel(spec.model)) {
      spec=new NativeRouting().fallback(selected.model);
      process.stderr.write(`Saved real model unavailable; resuming with ${spec.model}.\n`);
    }
  }
  if(resumed && virtualModel(spec.model))spec=new NativeRouting().fallback(spec.model);
  if(resumed && args.includes('--last') && selected.resumeThread) {
    args=args.filter(arg=>arg!=='--last');
    args.splice(selected.resumeIndex+1,0,selected.resumeThread);
  }
  if(virtualModel(selected.model) && !resumed) {
    let prompt=selected.positional.join('\n');
    if(!resumed && command!=='review' && (!prompt || selected.positional.includes('-')) && !process.stdin.isTTY) {
      const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);stdin=Buffer.concat(chunks);
      prompt=stdin.toString('utf8');
    }
    if(command==='review')spec=new NativeRouting().fallback(selected.model);
    else spec=await firstRequest({model:selected.model,prompt,client:'codex'});
    process.stderr.write(`Jev selected ${spec.model} · reasoning ${spec.effort || 'default'}\n`);
  }
  // Explicit reasoning is user intent and takes precedence over the routing profile.
  const effort=selected.explicitEffort?selected.effort:spec.effort;
  const provider=resumed && selected.savedProvider && !selected.explicitModel && selected.savedProvider!=='jev'?selected.savedProvider:'openai';
  const overrides=['-c','model_provider='+JSON.stringify(provider)];
  if(provider==='openai')overrides.push('-c','model_catalog_json='+JSON.stringify(install.realCatalog));
  // Native exec resume otherwise uses the GLOBAL new-chat default. Restore
  // metadata explicitly, preserving manual model and reasoning overrides.
  overrides.push('-c','model='+JSON.stringify(spec.model));
  if(effort)overrides.push('-c','model_reasoning_effort='+JSON.stringify(effort));
  const child=launch([...args,...overrides],stdin?['pipe','inherit','inherit']:'inherit');if(stdin)child.stdin.end(stdin);
} else {
  const serverArgs=[];
  for(let i=0;i<args.length;i++) {
    if(['-c','--config'].includes(args[i]) && args[i+1])serverArgs.push('-c',args[++i]);
    else if(args[i].startsWith('--config='))serverArgs.push('-c',args[i].slice(9));
    else if(args[i].startsWith('-c='))serverArgs.push('-c',args[i].slice(3));
    else if(args[i].startsWith('-c') && args[i].length>2)serverArgs.push('-c',args[i].slice(2));
    else if(['-p','--profile'].includes(args[i]) && args[i+1])serverArgs.push('-c','profile='+JSON.stringify(args[++i]));
    else if(args[i].startsWith('--profile='))serverArgs.push('-c','profile='+JSON.stringify(args[i].slice(10)));
    else if(args[i].startsWith('-p') && args[i].length>2)serverArgs.push('-c','profile='+JSON.stringify(args[i].slice(2)));
  }
  const server=await terminalServer({settings,serverArgs});cleanup=server.close;
  launch(['--remote',server.address,...args]);
}
