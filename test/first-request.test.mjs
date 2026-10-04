import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {firstRequest} from '../src/first-request.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));config.clients.hermes=true;
const catalog=()=>({models:[{slug:'gpt-6-luna'},{slug:'gpt-6.1-sol'}]});
test('Hermes selection uses only given first input, honours family mapping and emits metadata only',async()=>{
  let prompt;const logs=[];
  const spec=await firstRequest({model:'gpt-jev-sol',prompt:'Synthetic first message',client:'hermes'},
    {config:()=>config,catalog,classifier:async input=>{prompt=input;return {choice:'haiku',confidence:1};},logger:r=>logs.push(r)});
  assert.equal(prompt,'Synthetic first message');assert.equal(spec.model,'gpt-6.1-sol');
  assert(!JSON.stringify(logs).includes(prompt));assert.equal(logs[0].state,'native-first-request');
});
test('Manual models bypass classifier and disabled routing resolves a real fallback',async()=>{
  assert.deepEqual(await firstRequest({model:'gpt-6.1-sol',prompt:'Manual'}),{model:'gpt-6.1-sol',manual:true});
  const off=structuredClone(config);off.enabled=false;
  const spec=await firstRequest({model:'gpt-jev-auto',client:'hermes'},
    {config:()=>off,catalog,classifier:()=>{throw Error('must bypass');},logger:()=>{}});
  assert.equal(spec.model,off.providers.codex.fallbackModel);
});
