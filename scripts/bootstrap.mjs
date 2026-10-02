import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json')));
const upstream=path.join(root,'upstream');
function run(exe,args,cwd=root){const r=spawnSync(exe,args,{cwd,stdio:'inherit'});if(r.status!==0)throw Error('bootstrap failed');}
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node 22 or newer required');
if(fs.existsSync(upstream)) {
  const status=spawnSync('git',['status','--porcelain'],{cwd:upstream,encoding:'utf8'});
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'});
  if(status.status!==0 || status.stdout.trim() || head.stdout.trim()!==lock.commit)throw Error('Existing upstream differs; preserve it and inspect before bootstrap');
}else {
  run('git',['clone',lock.repository,upstream]);
  run('git',['checkout','--detach',lock.commit],upstream);
}
run('npm',['ci','--ignore-scripts'],upstream);
console.log('Pinned upstream and locked dependencies are ready.');
