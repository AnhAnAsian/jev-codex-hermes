import {modelChoices,reasoningValues,compatibleEffort,settingsEqual} from './settings-controls.js';
const $=id=>document.getElementById(id);
const tiers=['FAST','BALANCED','STRONG','LONG'],captions=['Small, familiar tasks','Everyday changes','Difficult debugging','Deep architecture'];
const customValue='__custom__';
let loaded,draft,provider='codex',dirty=false,busy=false;
const controls=new Map();
function message(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').setAttribute('role',error?'alert':'status');}
function setBusy(value){busy=value;$('settings-fields').disabled=value;$('reload').disabled=value;$('save').disabled=value||!dirty;$('reset').disabled=value||!dirty;$('save').textContent=value&&loaded?'Saving…':'Save changes';$('settings-form').setAttribute('aria-busy',String(value));}
function syncDirty(){capture();dirty=!settingsEqual(draft,loaded.settings);$('save-status').textContent=dirty?'Unsaved changes':'No unsaved changes';$('save').disabled=busy||!dirty;$('reset').disabled=busy||!dirty;updateRouting();}
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function selectedModel(c){return c.model.value===customValue?c.custom.value.trim():c.model.value;}
function renderReasoning(c,value,modelChanged=false){
  const model=selectedModel(c),values=reasoningValues(loaded,provider,model),current=value??'';
  const next=modelChanged?compatibleEffort(values,current):current;
  c.effort.replaceChildren(...values.map(e=>option(e,e||'No effort setting')));
  if(!values.includes(next))c.effort.append(option(next,next+' · saved, unsupported'));
  c.effort.value=next;
  const known=provider==='codex'&&loaded.models.some(m=>m.id===model);
  const warning=provider==='codex'&&!known?'Not in the picker catalog. Check this ID before using it.':!values.includes(next)?'Saved effort is unsupported. Choose a supported level.':modelChanged&&next!==current?'Reasoning adjusted to '+(next||'no effort setting')+' for this model.':'';
  c.feedback.textContent=warning;c.feedback.classList.toggle('warning',Boolean(warning));
  c.idText.textContent=model;c.idText.title=model;
  c.cost.hidden=!/-(astra|fable)(?:-|$)/.test(model);
}
function modelControl(key,spec){
  const box=document.createElement('div');box.className='model-controls';
  const modelBox=document.createElement('div');modelBox.className='model-field';
  const label=document.createElement('label');label.htmlFor='model-'+key;label.textContent='Model';
  const model=document.createElement('select');model.id='model-'+key;model.required=true;model.setAttribute('aria-label',key==='fallback'?'Fallback model':key+' model');
  const choices=modelChoices({...loaded,settings:draft},provider),groups=new Map();
  for(const choice of choices){const name=choice.extra?'Additional credits':provider==='claude'?'Configured models · availability unverified':choice.known?'Available in Codex':'Saved models · not in catalog';
    if(!groups.has(name)){const g=document.createElement('optgroup');g.label=name;groups.set(name,g);model.append(g);}
    groups.get(name).append(option(choice.id,choice.name+(provider==='codex'&&!choice.known?' · not in catalog':'')));
  }
  model.append(option(customValue,'Enter a custom model ID…'));model.value=spec.model||customValue;
  const idText=document.createElement('code');idText.className='model-id';
  const custom=document.createElement('input');custom.id='custom-'+key;custom.placeholder='Exact provider model ID';custom.maxLength=120;custom.autocomplete='off';custom.spellcheck=false;custom.hidden=Boolean(spec.model);custom.disabled=Boolean(spec.model);custom.required=!spec.model;custom.setAttribute('aria-label',key+' custom model ID');custom.setAttribute('pattern','[a-zA-Z0-9._:\\[\\]\\-]+');
  const feedback=document.createElement('p');feedback.id='feedback-'+key;feedback.className='field-note';feedback.setAttribute('aria-live','polite');model.setAttribute('aria-describedby',feedback.id);
  const cost=document.createElement('p');cost.className='field-note warning';cost.textContent='This choice may use additional credits.';cost.hidden=true;
  modelBox.append(label,model,idText,custom,feedback,cost);
  const effortBox=document.createElement('div');const effortLabel=document.createElement('label');effortLabel.htmlFor='effort-'+key;effortLabel.textContent='Reasoning';const effort=document.createElement('select');effort.id='effort-'+key;effort.setAttribute('aria-label',key==='fallback'?'Fallback reasoning':key+' reasoning');effortBox.append(effortLabel,effort);
  const c={model,custom,effort,feedback,idText,cost,box};controls.set(key,c);box.append(modelBox,effortBox);renderReasoning(c,spec.effort);
  model.addEventListener('change',()=>{const isCustom=model.value===customValue;custom.hidden=!isCustom;custom.disabled=!isCustom;custom.required=isCustom;if(isCustom)custom.focus();renderReasoning(c,effort.value,true);syncDirty();});
  custom.addEventListener('input',()=>{renderReasoning(c,effort.value,true);syncDirty();});
  effort.addEventListener('change',()=>{renderReasoning(c,effort.value);syncDirty();});
  return box;
}
function capture(){if(!draft)return;const p=draft.providers[provider];for(const tier of tiers){const c=controls.get(tier);p.tiers[tier]={model:selectedModel(c),effort:c.effort.value||null};}
  const c=controls.get('fallback');p.fallbackModel=selectedModel(c);p.fallbackEffort=c.effort.value||null;
  draft.disabledTiers=tiers.filter(t=>!$('tier-'+t).checked);draft.enabled=$('enabled').checked;draft.routing.codex=$('routing-codex').value;draft.routing.hermes=$('routing-hermes').value;draft.classificationMaxChars=Number($('max-chars').value);
}
function updateRouting(){
  $('routing-status').textContent=draft.enabled?'Jev chooses a tier for new tasks.':'Paused · Jev selections use your fallback model.';
  tiers.forEach(t=>{const off=draft.disabledTiers.includes(t);$('row-'+t).classList.toggle('tier-off',off);const c=controls.get(t);c.model.disabled=off;c.effort.disabled=off;c.custom.disabled=off||c.custom.hidden;});
  $('tiers-note').textContent=draft.disabledTiers.length===4?'All tiers are off. Enable a tier for automatic tier routing.':'Tier switches apply to both providers.';
}
function renderProvider(){const p=draft.providers[provider];controls.clear();$('tiers').replaceChildren();
  tiers.forEach((tier,i)=>{const row=document.createElement('div');row.className='tier-row';row.id='row-'+tier;
    const tag=document.createElement('div');tag.className='tier-tag';const toggle=document.createElement('label');toggle.className='toggle';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='tier-'+tier;checkbox.checked=!draft.disabledTiers.includes(tier);checkbox.setAttribute('aria-label','Use '+tier+' tier');
    const name=document.createElement('strong');name.textContent=tier;toggle.append(checkbox,name);const caption=document.createElement('p');caption.textContent=captions[i];tag.append(toggle,caption);row.append(tag,modelControl(tier,p.tiers[tier]));$('tiers').append(row);
  });
  $('fallback-controls').replaceChildren(modelControl('fallback',{model:p.fallbackModel,effort:p.fallbackEffort}));
  $('provider-help').textContent=provider==='codex'?'Choose from your local Codex catalog. Custom IDs are optional.':'Claude discovery is unavailable. Verify model access with your provider.';
  updateRouting();
}
function apply(data){loaded=data;draft=structuredClone(data.settings);$('enabled').checked=draft.enabled;$('routing-codex').value=draft.routing.codex;$('routing-hermes').value=draft.routing.hermes;$('max-chars').value=draft.classificationMaxChars;
  $('classifier').textContent='Task excerpts are sent '+(data.classifier==='openrouter'?'through OpenRouter to TypeSafe / Jev.':'directly to TypeSafe / Jev.');renderProvider();dirty=false;$('save-status').textContent='No unsaved changes';$('save-help').textContent='Existing pinned chats keep their model. Each save creates a private backup.';$('settings-form').hidden=false;
}
async function load(){if(busy)return;setBusy(true);try{const r=await fetch('/settings/state',{cache:'no-store',signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Settings unavailable.');apply(data);message('Your saved settings. Changes apply when you save.');}catch(e){message(e.name==='TimeoutError'?'Loading timed out. Try Reload settings.':e.message,true);}finally{setBusy(false);}}
$('provider').addEventListener('change',()=>{capture();provider=$('provider').value;renderProvider();syncDirty();});
$('settings-form').addEventListener('change',event=>{if(['provider'].includes(event.target.id)||event.target.id.startsWith('model-')||event.target.id.startsWith('effort-'))return;syncDirty();});
$('max-chars').addEventListener('input',syncDirty);
$('reload').addEventListener('click',()=>{if(!busy&&(!dirty||window.confirm('Discard unsaved changes and reload?')))load();});
$('reset').addEventListener('click',()=>{if(!busy){apply(loaded);setBusy(false);message('Unsaved changes discarded. Your saved settings are unchanged.');}});
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!dirty)return;capture();
  for(const name of ['codex','claude']){const p=draft.providers[name];for(const [key,id] of [...Object.entries(p.tiers).map(([t,s])=>[t,s.model]),['fallback',p.fallbackModel]]){if(!id){provider=name;$('provider').value=name;renderProvider();message('Enter a model ID for '+name+' '+key+' before saving.',true);controls.get(key).custom.focus();return;}}}
  setBusy(true);
  try{const r=await fetch('/settings/state',{method:'POST',headers:{'content-type':'application/json','x-jev-settings-token':loaded.token},body:JSON.stringify({revision:loaded.revision,settings:draft}),signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Settings could not be saved.');apply(data);$('save-status').textContent='Saved · backup created';$('save-help').textContent=data.modelsChanged?'Refresh the catalog and restart Desktop after changing model IDs.':'New chats use your updated mappings. Existing chats keep their pinned choice.';message(data.modelsChanged?'Saved with a private backup. Model IDs changed: run jev-router refresh-catalog and restart Desktop to update context limits.':'Saved with a private backup. New chats use your updated mappings.');await health();}catch(e){$('save-status').textContent='Save failed';$('save-help').textContent='Your edits are still here. Review the error above before retrying.';message(e.name==='TimeoutError'?'Save timed out. Reload settings to check whether it completed before retrying.':e.message,true);}finally{setBusy(false);}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function health(){try{const r=await fetch('/health',{signal:AbortSignal.timeout(5000)});const h=await r.json();$('health').textContent=!h.ok?'Configuration needs repair':!h.enabled?'Routing paused':h.keyAvailable?'Routing ready · '+h.classifier:'Classifier key missing';$('health').classList.toggle('warning',!h.ok||!h.keyAvailable);}catch{$('health').textContent='Service unavailable';}}
load();health();
