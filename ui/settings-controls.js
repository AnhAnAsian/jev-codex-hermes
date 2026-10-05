// Pure UI helpers shared with the regression suite. No credentials or routing calls.
export const effortValues=['','none','minimal','low','medium','high','xhigh','max','ultra'];
export function modelName(id) {
  if(/^gpt-\d/.test(id))return id.replace(/^gpt-/,'GPT-').replace(/-(luna|sol|astra|terra|fable)$/,(_,family)=>' '+family[0].toUpperCase()+family.slice(1));
  if(/^claude-/.test(id))return id.replace(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)(?:-\d{8})?$/,(_,name,major,minor)=>'Claude '+name[0].toUpperCase()+name.slice(1)+' '+major+'.'+minor);
  return id;
}
export const extraCredits=id=>/-(astra|fable)(?:-|$)/.test(id);
export function modelChoices(data,provider,family=null) {
  const p=family?data.settings.variants.codex[family]:data.settings.providers[provider];
  const saved=[...Object.values(p.tiers).map(s=>s.model),p.fallbackModel];
  const catalog=provider==='codex'?data.models.filter(m=>!family||m.id.endsWith('-'+family)):[];
  const known=[...new Set(catalog.map(m=>m.id))];
  return [...known,...[...new Set(saved)].filter(id=>id&&!known.includes(id))].map(id=>({id,name:modelName(id),known:known.includes(id),extra:extraCredits(id)}));
}
export function reasoningValues(data,provider,model) {
  if(provider==='claude' && /^claude-haiku(?:-|$)/.test(model))return [''];
  if(provider==='codex') {
    const levels=data.models.find(m=>m.id===model)?.efforts?.filter(e=>effortValues.includes(e));
    if(levels?.length)return [...new Set(levels)];
  }
  return provider==='claude'?['','low','medium','high','xhigh']:effortValues;
}
export function compatibleEffort(values,current) {
  const value=current??'';
  return values.includes(value)?value:values.includes('low')?'low':values[0]??'';
}
export function settingsEqual(a,b) {
  const ordered=s=>({...s,disabledTiers:[...s.disabledTiers].sort()});
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
}
export function changedSections(before,after) {
  const changed=profileChoices(after).filter(p=>JSON.stringify(profileMap(before,p.id))!==JSON.stringify(profileMap(after,p.id))).map(p=>p.name.split(' · ')[0]);
  if(['enabled','classificationMaxChars','routing'].some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])) ||
    JSON.stringify([...before.disabledTiers].sort())!==JSON.stringify([...after.disabledTiers].sort()))changed.push('Global settings');
  return changed;
}
export const profileProvider=id=>id==='claude'?'claude':'codex';
export const profileFamily=id=>['luna','sol'].includes(id)?id:null;
export function profileMap(settings,id) {
  const family=profileFamily(id);
  return family?settings.variants?.codex?.[family]:settings.providers[profileProvider(id)];
}
export function profileChoices(settings) {
  return [{id:'codex',name:'Jev · mixed models',command:'/model jev',description:'Jev can choose a different model for each tier.'},
    ...['luna','sol'].filter(f=>settings.variants?.codex?.[f]).map(f=>({id:f,name:'Jev '+f[0].toUpperCase()+f.slice(1)+' · '+f+' only',command:'/model jev-'+f,description:'Every tier stays within the '+f+' family.'})),
    {id:'claude',name:'Claude · Anthropic mapping',command:'Claude Code / Hermes Anthropic',description:'Configure the Anthropic models used by Jev.'}];
}
export function profileError(settings) {
  for(const {id,name} of profileChoices(settings)) {
    const p=profileMap(settings,id),family=profileFamily(id);
    for(const [field,model] of [...Object.entries(p.tiers).map(([t,s])=>[t,s.model]),['fallback',p.fallbackModel]]) {
      if(!model)return {profile:id,field,message:'Enter a model ID for '+name+' '+field+'.'};
      if(!/^[a-zA-Z0-9._\-:\[\]]{1,120}$/.test(model))return {profile:id,field,message:'Check the model ID for '+name+' '+field+'. Use only letters, numbers, dots, underscores, hyphens, colons and brackets.'};
      if(model.includes('jev-') || model==='jev-auto')return {profile:id,field,message:'Use a real provider model ID for '+name+' '+field+'.'};
      if(family&&!model.endsWith('-'+family))return {profile:id,field,message:name+' requires a model ID ending in -'+family+' for '+field+'.'};
    }
  }
  return null;
}
