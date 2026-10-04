#!/usr/bin/env node
import {firstRequest} from './src/first-request.mjs';
let input='';
for await(const chunk of process.stdin) {
  input+=chunk;
  if(Buffer.byteLength(input)>1024*1024) {process.stderr.write('Initial message exceeds routing input limit.\n');process.exit(1);}
}
try {
  const request=JSON.parse(input);
  process.stdout.write(JSON.stringify(await firstRequest(request))+'\n');
} catch {process.stderr.write('Initial model selection failed.\n');process.exitCode=1;}
