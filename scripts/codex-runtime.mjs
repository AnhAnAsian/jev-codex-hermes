#!/usr/bin/env node
import {runtime} from '../src/codex-runtime.mjs';
try {
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw new Error();}
  const options=JSON.parse(input),service=runtime(options);
  const result=options.action==='reload'?await service.reload():await service.check(options.changed===true);
  console.log(JSON.stringify(result));
}catch{console.log(JSON.stringify({state:'unavailable'}));process.exitCode=1;}
