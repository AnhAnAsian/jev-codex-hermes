import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {WebSocketServer,WebSocket} from 'ws';

// --remote uses WebSocket framing over a private Unix socket. This carries
// native app-server RPC only; inference stays inside the native server.
export async function terminalServer({settings,serverArgs=[]}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-cli-'));fs.chmodSync(dir,0o700);
  const socket=path.join(dir,'rpc.sock'),server=http.createServer(),wss=new WebSocketServer({server,maxPayload:0});
  let child,peer;
  const close=()=>{child?.kill();peer?.terminate();wss.close();server.close();fs.rmSync(dir,{recursive:true,force:true});};
  wss.on('connection',connection=>{
    if(peer){connection.close(1008,'Single client endpoint');return;}
    peer=connection;
    child=spawn(process.execPath,[new URL('../native-codex.mjs',import.meta.url).pathname,'app-server',...serverArgs],
      {stdio:['pipe','pipe','inherit'],env:{...process.env,JEV_NATIVE_SETTINGS_FILE:settings}});
    peer.on('message',data=>{if(!child.stdin.write(data+'\n'))peer.pause();});
    child.stdin.on('drain',()=>peer.resume());child.stdin.on('error',()=>{});
    let fragmented=false;
    child.stdout.on('data',chunk=>{
      if(peer.readyState!==WebSocket.OPEN)return;
      let offset=0;
      while(offset<chunk.length){
        const newline=chunk.indexOf(10,offset),end=newline<0?chunk.length:newline;
        const piece=chunk.subarray(offset,end);
        if(piece.length || fragmented)peer.send(piece,{binary:false,fin:newline>=0},error=>{
          if(error)child.kill();
          if(peer.bufferedAmount<1024*1024)child.stdout.resume();
        });
        fragmented=newline<0;offset=end+1;
      }
      if(peer.bufferedAmount>1024*1024)child.stdout.pause();
    });
    child.on('error',()=>peer.close(1011,'Native runtime unavailable'));
    child.on('exit',()=>peer.close());peer.on('close',()=>child.kill());
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});fs.chmodSync(socket,0o600);
  return {address:'unix://'+socket,close};
}
