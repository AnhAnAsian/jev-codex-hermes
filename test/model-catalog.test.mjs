import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCatalogLoader} from '../src/model-catalog.mjs';

test('Catalog cache observes external edits, atomic replacements, fallback and restored priority',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-catalog-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const first=path.join(dir,'first.json'),second=path.join(dir,'second.json');
 const data=slug=>JSON.stringify({models:[{slug,nested:{effort:'low'}}]});
 fs.writeFileSync(first,data('model-a'));fs.writeFileSync(second,data('model-b'));
 const read=createCatalogLoader([first,second]),initial=read();assert.equal(read(),initial);
 assert.throws(()=>{initial.models[0].nested.effort='high';});
 const stat=fs.statSync(first);fs.writeFileSync(first,data('model-c'));fs.utimesSync(first,stat.atime,stat.mtime);assert.equal(read().models[0].slug,'model-c');
 fs.writeFileSync(first+'.tmp',data('model-d'));fs.renameSync(first+'.tmp',first);assert.equal(read().models[0].slug,'model-d');
 fs.writeFileSync(first,'{');assert.equal(read().models[0].slug,'model-b');
 fs.writeFileSync(first,data('model-e'));assert.equal(read().models[0].slug,'model-e');
 fs.unlinkSync(first);assert.equal(read().models[0].slug,'model-b');
 fs.writeFileSync(second,'{"models":[]}');assert.deepEqual(read(),{models:[]});
});
