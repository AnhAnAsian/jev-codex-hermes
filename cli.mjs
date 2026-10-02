#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {readConfig,configPath,home,loadKey} from './src/settings.mjs';
import {classify,RoutingEngine} from './src/routing.mjs';
import {codexArgs} from './upstream/src/codex-cli.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const LABEL='ai.typesafe.jev-router.local',domain=`gui/${os.userInfo().uid}`;
const plist=path.join(os.homedir(),'Library/LaunchAgents',LABEL+'.plist');
const action=process.argv[2]||'status';
const endpoint=()=>`http://127.0.0.1:${readConfig().port}`;
const saveConfig=c=>{const tmp=configPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(c,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,configPath);};
function manage(command) {
  const r=spawnSync(process.env.JEV_PYTHON || 'python3',[path.join(ROOT,'manage.py'),command],{stdio:'inherit',env:process.env});
  if(r.status!==0)throw new Error('configuration_failed');
}
function launch(args,quiet=false) {
  return spawnSync('/bin/launchctl',args,{stdio:quiet?'ignore':'pipe'});
}
async function health() {try{return await(await fetch(endpoint()+'/health',{signal:AbortSignal.timeout(2000)})).json();}catch{return {ok:false};}}
async function start() {
  if(!fs.existsSync(plist))manage('install-service');
  launch(['enable',`${domain}/${LABEL}`],true);
  launch(['bootstrap',domain,plist],true);
  launch(['kickstart',`${domain}/${LABEL}`],true);
  for(let i=0;i<50;i++){if((await health()).ok)return;
    // launchd can finish bootout asynchronously; retry registration during startup.
    if(i%5===0){launch(['bootstrap',domain,plist],true);launch(['kickstart',`${domain}/${LABEL}`],true);}
    await new Promise(r=>setTimeout(r,200));}
  throw new Error('service_not_ready');
}
function refreshCatalog() {
  const p=path.join(os.homedir(),'.codex/models_cache.json');
  const catalog={models:JSON.parse(fs.readFileSync(p,'utf8')).models};
  const engine=new RoutingEngine({config:readConfig,logger:()=>{}});
  const out=engine.catalog(catalog);
  fs.writeFileSync(path.join(home,'codex-models.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600});
}
function stop() {launch(['bootout',`${domain}/${LABEL}`],true);}
async function privateKey() {
  if(!process.stdin.isTTY)throw new Error('run_key_in_your_terminal');
  const c=readConfig(),openrouter=process.argv.includes('--openrouter') || c.classifier?.provider==='openrouter';
  process.stdout.write(openrouter?'OpenRouter key (hidden): ':'Jev/TypeSafe key (hidden): ');
  const wasRaw=process.stdin.isRaw;
  process.stdin.setRawMode(true);process.stdin.resume();
  const key=await new Promise((resolve,reject)=>{
    let bytes='';
    const onData=data=>{
      for(const ch of data.toString()) {
        if(ch==='\u0003'){cleanup();reject(new Error('cancelled'));return;}
        if(ch==='\r'||ch==='\n'){cleanup();resolve(bytes.trim());return;}
        if(ch==='\u007f')bytes=bytes.slice(0,-1);else if(ch>=' ')bytes+=ch;
      }
    };
    const cleanup=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(wasRaw||false);process.stdin.pause();};
    process.stdin.on('data',onData);
  });
  process.stdout.write('\n');if(!key)throw new Error('empty_key');
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  if(!/^[A-Za-z0-9_.-]+$/.test(key))throw new Error('invalid_key_characters');
  const backup=path.join(home,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  const p=path.join(home,'key.env');
  for(const f of [configPath,p])if(fs.existsSync(f)){const dest=path.join(backup,path.basename(f));fs.copyFileSync(f,dest);fs.chmodSync(dest,0o600);}
  // Preserve a previously configured key for the other classification backend.
  const previous=fs.existsSync(p)?fs.readFileSync(p,'utf8').split('\n'):[];
  const variable=openrouter?'OPENROUTER_API_KEY':'JEV_API_KEY';
  const lines=previous.filter(x=>x && !x.startsWith(variable+'='));lines.push(variable+'='+key);
  fs.writeFileSync(p,lines.join('\n')+'\n',{mode:0o600});fs.chmodSync(p,0o600);
  c.classifier=openrouter?{provider:'openrouter',model:'jev-1.13'}:{provider:'typesafe'};saveConfig(c);
  stop();await start();console.log('Private key saved with owner-only permissions. Service restarted.');
}
async function doctor() {
  const c=readConfig(),checks=[];
  const readJSON=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return {};}};
  const text=p=>{try{return fs.readFileSync(p,'utf8');}catch{return '';}};
  checks.push({check:'Classifier key available',ok:Boolean(loadKey(c))});
  const jev=await classify('Rename a variable and fix a typo.',c);
  checks.push({check:'Classifier API responds',ok:Boolean(jev),confidence:jev?.confidence??null});
  const h=await health();checks.push({check:'Local service',ok:h.ok===true,enabled:h.enabled});
  const sockets=spawnSync('/usr/sbin/lsof',['-nP',`-iTCP:${c.port}`,'-sTCP:LISTEN'],{encoding:'utf8'});
  checks.push({check:'Localhost-only listener',ok:sockets.status===0 && sockets.stdout.includes(`127.0.0.1:${c.port}`) && !sockets.stdout.includes(`*:${c.port}`)});
  if(c.clients?.codex) {
    const record=readJSON(path.join(home,'desktop-picker.json'));
    const cfg=text(path.join(os.homedir(),'.codex/config.toml'));
    const catalog=readJSON(path.join(home,'desktop-models.json'));
    checks.push({check:'Desktop provider and picker configured',ok:record.active===true && cfg.includes(record.block||'UNCONFIGURED') && catalog.models?.some(m=>m.slug==='gpt-jev-auto'),detail:'Configuration check; a normal Desktop request is a separate acceptance test.'});
    const models=readJSON(path.join(os.homedir(),'.codex/models_cache.json')).models||[];
    for(const [tier,spec] of Object.entries(c.providers.codex.tiers)) {
      const model=models.find(m=>m.slug===spec.model);
      checks.push({check:'Codex '+tier+' model/effort available',ok:Boolean(model && (!spec.effort || model.supported_reasoning_levels?.some(e=>e.effort===spec.effort))),model:spec.model,effort:spec.effort});
    }
  }
  const manifest=readJSON(path.join(home,'integration.json'));
  if(c.clients?.hermes)checks.push({check:'Hermes integration',ok:manifest.active===true && text(path.join(os.homedir(),'.hermes/config.yaml')).includes(endpoint()+'/hermes/'),detail:'Original provider owns authentication; live generation must be tested separately.'});
  if(c.clients?.claude) {
    checks.push({check:'Claude integration',ok:manifest.active===true && text(path.join(os.homedir(),'.claude/settings.json')).includes(endpoint()+'/claude')});
    const auth=spawnSync('claude',['auth','status','--json'],{encoding:'utf8',timeout:10000});
    let loggedIn=false;try{loggedIn=auth.status===0 && JSON.parse(auth.stdout).loggedIn===true;}catch{}
    checks.push({check:'Claude client reports login',ok:loggedIn,detail:'Login status does not prove refresh or routed generation.'});
  }
  for(const [provider,p] of Object.entries(c.providers)) {
    if(provider==='claude' && !c.clients?.claude)continue;
    try{const r=await fetch(p.upstream,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});checks.push({check:provider+' upstream reachable',ok:r.status<500,status:r.status,authenticated:false});}
    catch{checks.push({check:provider+' upstream reachable',ok:false});}
  }
  checks.push({check:'Authentication design',ok:true,detail:'Static design statement: headers forwarded transiently; client credential stores are not opened. This is not an authenticated provider test.'});
  console.log(JSON.stringify({checks,passed:checks.filter(x=>x.ok).length,total:checks.length},null,2));
  if(checks.some(x=>!x.ok))process.exitCode=1;
}
async function client(name,args) {
  const c=readConfig(),h=await health();
  const env={...process.env};let command=name;
  // The persistent configuration handles normal clients. Named commands also
  // work when integration is disabled, and fail back to the normal client if
  // the router is unavailable.
  if(c.enabled && h.ok) {
    if(name==='claude') {
      env.ANTHROPIC_BASE_URL=endpoint()+'/claude';
      env.ANTHROPIC_MODEL=env.ANTHROPIC_MODEL||'jev-auto';
      env.ANTHROPIC_CUSTOM_MODEL_OPTION='jev-auto';env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||'200000';
    }else if(name==='codex') {
      args=codexArgs(endpoint()+'/codex',args);
    }else {
      env.HERMES_CODEX_BASE_URL=endpoint()+'/hermes/codex';
    }
  }
  const child=spawn(command,args,{env,stdio:'inherit'});
  child.on('error',()=>{console.error('Client executable unavailable.');process.exitCode=1;});
  child.on('exit',(code)=>{process.exitCode=code??1;});
}
try {
  if(action==='start'){await start();console.log('Router running.');}
  else if(action==='stop'){manage('disable');launch(['disable',`${domain}/${LABEL}`],true);stop();console.log('Router stopped; clients restored to direct operation. Startup resumes with jev-router start.');}
  else if(action==='restart'){stop();await start();console.log('Router restarted.');}
  else if(action==='status')console.log(JSON.stringify(await health(),null,2));
  else if(action==='doctor')await doctor();
  else if(action==='desktop-enable'){await start();manage('desktop-enable');}
  else if(action==='desktop-disable')manage('desktop-disable');
  else if(action==='key')await privateKey();
  else if(action==='classify-test') {
    const c=readConfig();
    const tasks=[['FAST','Rename a variable and fix a typo.'],['BALANCED','Add a small API endpoint following the existing project pattern.'],['STRONG','Debug an intermittent concurrency bug whose cause is unknown.'],['LONG','Design and prove a safe migration of a distributed scheduler from a single leader to multi-region consensus. Resolve partition tolerance, fencing, idempotency, crash recovery, rolling upgrades and conflicting invariants; analyze alternatives and provide correctness arguments.']];
    for(const [expected,prompt] of tasks){const r=await classify(prompt,c);console.log(JSON.stringify({expected,classified:r?({haiku:'FAST',sonnet:'BALANCED',opus:'STRONG',fable:'LONG'})[r.choice]:null,confidence:r?.confidence??null,classifier_model:r?.classifier_model??null,latency_ms:r?.ms??null,ok:Boolean(r)}));if(!r)process.exitCode=1;}
  }
  else if(action==='enable'){await start();const c=readConfig();c.enabled=true;saveConfig(c);refreshCatalog();manage('enable');if(c.clients?.codex)manage('desktop-enable');console.log('Restart enabled clients and select Jev to route new conversations.');}
  else if(action==='refresh-catalog'){refreshCatalog();console.log('Local Jev model catalog refreshed from the client cache.');}
  else if(action==='update') {
    const upstream=path.join(ROOT,'upstream');
    const old=spawnSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
    if(spawnSync('git',['-C',upstream,'status','--porcelain'],{encoding:'utf8'}).stdout.trim())throw new Error('upstream_has_local_edits');
    const steps=[['git',['-C',upstream,'fetch','origin','main']],['git',['-C',upstream,'merge','--ff-only','origin/main']],['npm',['ci','--ignore-scripts','--prefix',upstream]],['npm',['test','--prefix',upstream]],['npm',['test','--prefix',ROOT]]];
    let ok=true;
    for(const [exe,args] of steps){if(spawnSync(exe,args,{stdio:'inherit'}).status!==0){ok=false;break;}}
    if(!ok){spawnSync('git',['-C',upstream,'reset','--hard',old],{stdio:'ignore'});spawnSync('npm',['ci','--ignore-scripts','--prefix',upstream],{stdio:'ignore'});console.log('Update checks failed; restored the previous upstream revision.');process.exitCode=1;}
    else {stop();await start();console.log('Updated upstream and passed both verification suites.');}
  }
  else if(action==='disable'){const c=readConfig();c.enabled=false;saveConfig(c);manage('disable');console.log('Restart clients for direct operation. Running routed turns use the saved normal defaults.');}
  else if(action==='logs') {
    const p=path.join(home,'decisions.jsonl');
    if(process.argv.includes('--follow')){const child=spawn('/usr/bin/tail',['-f',p],{stdio:'inherit'});child.on('exit',code=>process.exitCode=code??0);}
    else console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\n').slice(-30).join('\n'):'No routing decisions yet.');
  }
  else if(action==='config')console.log(configPath);
  else if(action==='uninstall'){manage('uninstall');console.log('For full removal including private key/backups, follow the uninstall instructions in README.md.');}
  else if(['claude','codex','hermes'].includes(action))await client(action,process.argv.slice(3));
  else console.log('Usage: jev-router start|stop|restart|status|doctor|desktop-enable|desktop-disable|key [--openrouter]|classify-test|enable|disable|logs [--follow]|config|uninstall|claude|codex|hermes');
}catch {console.error('Jev command failed. Run jev-router doctor, or jev-router disable to restore the normal clients.');process.exitCode=1;}
