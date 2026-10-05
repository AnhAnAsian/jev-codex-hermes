// The SSH app-server loads config/catalog at startup, independently of Desktop.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import WebSocket from 'ws';

const digest=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=()=>new Error('runtime_unavailable');

export async function connect(socket,timeout=3000) {
  // Colon/question-mark socket names are not representable by ws+unix.
  if(/[?:]/.test(socket))throw failure();
  // Older app-servers reject ws' default Unix Host header during the upgrade.
  const ws=new WebSocket(`ws+unix:${socket}:/`,{headers:{Host:'localhost'},perMessageDeflate:false,handshakeTimeout:timeout,maxPayload:1024*1024});
  const pending=new Map();let sequence=0,unsafe=false;
  const rejectAll=()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(failure());}pending.clear();};
  ws.on('error',rejectAll);ws.on('close',rejectAll);
  ws.on('message',bytes=>{
    let message;try{message=JSON.parse(bytes);if(!message || typeof message!=='object' || (message.method!==undefined && typeof message.method!=='string'))throw failure();}catch{rejectAll();ws.terminate();return;}
    // Never acknowledge approvals or collect turn contents.
    if(message.method==='turn/started' || message.method?.includes('requestApproval') ||
       (message.method==='thread/status/changed' && !['idle','notLoaded'].includes(message.params?.status?.type)))unsafe=true;
    const item=pending.get(message.id);
    if(!item || message.method)return;
    pending.delete(message.id);clearTimeout(item.timer);
    if(message.error)item.reject(failure());else item.resolve(message.result);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(failure());},timeout);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params}),error=>{if(error)rejectAll();});
  });
  try {
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',()=>reject(failure()));ws.once('close',()=>reject(failure()));});
    await call('initialize',{clientInfo:{name:'jev_runtime_check',version:'1.0'},capabilities:{experimentalApi:true}});
    ws.send(JSON.stringify({method:'initialized'}));
    return {call,get unsafe(){return unsafe;},close:()=>{rejectAll();ws.terminate();}};
  }catch {ws.terminate();throw failure();}
}

async function pages(rpc,method,params={}) {
  const data=[],seen=new Set();let cursor;
  for(let page=0;page<100;page++) {
    const result=await rpc.call(method,{...params,limit:100,...(cursor?{cursor}:{})});
    if(!Array.isArray(result?.data))throw failure();
    data.push(...result.data);cursor=result.nextCursor;
    if(cursor==null)return data;
    if(typeof cursor!=='string' || !cursor || seen.has(cursor))throw failure();
    seen.add(cursor);
  }
  throw failure();
}

export async function snapshot(socket,expected=[],timeout) {
  const rpc=await connect(socket,timeout);
  try {
    const models=await pages(rpc,'model/list',{includeHidden:true});
    const missing=expected.filter(model=>!models.some(live=>live.id===model.id &&
      (!model.displayName || live.displayName===model.displayName))).map(model=>model.id);
    const ids=await pages(rpc,'thread/loaded/list');let busy=0;
    for(const id of ids) {
      if(typeof id!=='string')throw failure();
      const result=await rpc.call('thread/read',{threadId:id,includeTurns:false});
      // Unknown status/protocol versions fail closed, including pending approvals.
      if(!['idle','notLoaded'].includes(result?.thread?.status?.type))busy++;
    }
    return {missing,busy:busy+(rpc.unsafe?1:0)};
  }finally {rpc.close();}
}

export function owner(socket,system={stat:fs.lstatSync,exec:execFileSync,uid:process.getuid()}) {
  const stat=system.stat(socket);
  if(!stat.isSocket() || stat.uid!==system.uid)throw failure();
  const output=system.exec('/usr/sbin/lsof',['-n','-Fpcu','-a','-U',socket],{encoding:'utf8',timeout:3000,maxBuffer:65536});
  const processes=[];
  for(const line of output.split('\n')) {
    if(line.startsWith('p'))processes.push({pid:Number(line.slice(1))});
    else if(processes.length && line.startsWith('c'))processes.at(-1).command=line.slice(1);
    else if(processes.length && line.startsWith('u'))processes.at(-1).uid=Number(line.slice(1));
  }
  if(processes.length!==1)throw failure();
  const processInfo=processes[0];
  if(!Number.isSafeInteger(processInfo.pid) || processInfo.pid<=1 || processInfo.command!=='codex' || processInfo.uid!==system.uid)throw failure();
  const command=system.exec('/bin/ps',['-p',String(processInfo.pid),'-o','lstart=','-o','command='],{encoding:'utf8',timeout:3000,maxBuffer:65536});
  if(!/\bapp-server\b/.test(command) || !/--listen(?:=|\s+)unix:\/\//.test(command))throw failure();
  return {pid:processInfo.pid,identity:digest(`${stat.dev}:${stat.ino}:${processInfo.pid}:${command}`)};
}

function loadPending(file) {
  try {const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value && (value.identity===null || typeof value.identity==='string'))return value;throw failure();}
  catch(error){if(error.code==='ENOENT')return null;throw failure();}
}
function savePending(file,identity) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(file+'.tmp',JSON.stringify({identity})+'\n',{mode:0o600});
  fs.chmodSync(file+'.tmp',0o600);fs.renameSync(file+'.tmp',file);
}

export function runtime(options,overrides={}) {
  const socket=path.join(options.codexHome,'app-server-control/app-server-control.sock');
  const pending=path.join(options.state,'codex-runtime-reload.json');
  const deps={owner,snapshot,signal:pid=>process.kill(pid,'SIGTERM'),sleep,
    start:()=>execFileSync(options.codex,['app-server','daemon','start'],{env:{...process.env,CODEX_HOME:options.codexHome},timeout:10000,maxBuffer:65536,stdio:'pipe'}),...overrides};
  const exists=()=>{try{fs.lstatSync(socket);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  async function check(changed=false) {
    try {
      if(!exists()){fs.rmSync(pending,{force:true});return {state:'not-running',busy:0};}
      // Persist the need to reload even if the RPC check cannot complete.
      let record=loadPending(pending);
      if(changed){savePending(pending,null);record={identity:null};}
      const before=deps.owner(socket);
      if(record?.identity===null){savePending(pending,before.identity);record={identity:before.identity};}
      const live=await deps.snapshot(socket,options.expected);
      if(deps.owner(socket).identity!==before.identity)return {state:'unavailable'};
      const stale=live.missing.length>0 || record?.identity===before.identity;
      if(!stale)fs.rmSync(pending,{force:true});
      return {state:stale?'reload-required':'ready',busy:live.busy,missing:live.missing,identity:before.identity};
    }catch{return {state:'unavailable'};}
  }
  async function reload() {
    const current=await check();
    if(['ready','not-running','unavailable'].includes(current.state))return current;
    if(current.busy)return {...current,state:'busy'};
    try {
      const before=deps.owner(socket);
      if(before.identity!==current.identity)return await check();
      // Recheck immediately before the signal; any new work/owner change blocks it.
      const live=await deps.snapshot(socket,options.expected);
      if(live.busy)return {state:'busy',busy:live.busy};
      if(deps.owner(socket).identity!==before.identity)return {state:'unavailable'};
      savePending(pending,before.identity);
      deps.signal(before.pid);
      let started=false;
      for(let attempt=0;attempt<40;attempt++) {
        await deps.sleep(250);
        if(exists()) {
          const replacement=deps.owner(socket);
          if(replacement.identity!==before.identity) {
            const result=await check();
            if(result.state==='ready')return {...result,reloaded:true};
            // Never signal a replacement, even if it still has a stale catalog.
            if(result.state==='reload-required')return result;
          }
        }else if(!started) {
          started=true;
          try{deps.start();}catch{/* Desktop may have won the idempotent startup race. */}
        }
      }
    }catch{/* Keep the pending journal and return only a bounded diagnostic. */}
    return {state:'unavailable'};
  }
  return {check,reload};
}
