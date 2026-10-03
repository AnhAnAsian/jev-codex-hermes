// Pure UI helpers shared with the regression suite. No credentials or routing calls.
export const effortValues=['','none','minimal','low','medium','high','xhigh','max','ultra'];
export function modelName(id) {
  if(/^gpt-\d/.test(id))return id.replace(/^gpt-/,'GPT-').replace(/-(luna|sol|astra|terra|fable)$/,(_,family)=>' '+family[0].toUpperCase()+family.slice(1));
  if(/^claude-/.test(id))return id.replace(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)(?:-\d{8})?$/,(_,name,major,minor)=>'Claude '+name[0].toUpperCase()+name.slice(1)+' '+major+'.'+minor);
  return id;
}
export const extraCredits=id=>/-(astra|fable)(?:-|$)/.test(id);
export function modelChoices(data,provider) {
  const p=data.settings.providers[provider];
  const saved=[...Object.values(p.tiers).map(s=>s.model),p.fallbackModel];
  const catalog=provider==='codex'?data.models:[];
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
