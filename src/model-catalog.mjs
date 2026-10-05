import fs from 'node:fs';

const version=file=>{
  const s=fs.statSync(file,{bigint:true});
  return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
};
function freeze(value) {
  const pending=[value];
  while(pending.length){const item=pending.pop();if(item && typeof item==='object'){Object.freeze(item);for(const child of Object.values(item))if(child && typeof child==='object')pending.push(child);}}
  return value;
}
// Check file identity on every access. Cache only parsed, immutable catalogs;
// replacements, deletions, corruption and candidate precedence remain observable.
export function createCatalogLoader(files) {
  const cached=new Map();
  return ()=>{
    for(const file of files) {
      try {
        for(let attempt=0;attempt<2;attempt++) {
          const stamp=version(file),entry=cached.get(file);
          if(entry?.stamp===stamp)return entry.value;
          const value=JSON.parse(fs.readFileSync(file,'utf8'));
          if(version(file)!==stamp)continue;
          if(!Array.isArray(value.models) || !value.models.length)break;
          freeze(value);cached.set(file,{stamp,value});return value;
        }
      }catch {}
      cached.delete(file);
    }
    return {models:[]};
  };
}
