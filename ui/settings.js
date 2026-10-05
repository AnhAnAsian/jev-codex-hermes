import {modelName,modelChoices,reasoningValues,compatibleEffort,settingsEqual,changedSections,profileProvider,profileFamily,profileMap,profileChoices,profileError} from './settings-controls.js';
import {checkHealth} from './status.js';
const $=id=>document.getElementById(id);
const tiers=['FAST','BALANCED','STRONG','LONG'],captions=['Small, familiar tasks','Everyday changes','Difficult debugging','Deep architecture'];
const customValue='__custom__';
let loaded,draft,profile='codex',provider='codex',dirty=false,busy=false;
const controls=new Map();
function message(text,error=false){$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error);$('notice').setAttribute('role',error?'alert':'status');if(error)$('notice').focus();}
function setBusy(value){busy=value;$('settings-fields').disabled=value;$('reload').disabled=value;$('save').disabled=value||!dirty;$('reset').disabled=value||!dirty;$('save').textContent=value&&loaded?'Saving…':'Save changes';$('settings-form').setAttribute('aria-busy',String(value));}
function syncDirty(){capture();dirty=!settingsEqual(draft,loaded.settings);$('save-status').textContent=dirty?'Changed: '+changedSections(loaded.settings,draft).join(', '):'';$('save-bar').hidden=!dirty;$('save').disabled=busy||!dirty;$('reset').disabled=busy||!dirty;message('');updateRouting();}
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
  c.idText.textContent=model;c.model.title=model;c.idText.hidden=!$('show-ids').checked && c.model.value!==customValue && !(provider==='codex'&&!known);
  c.cost.hidden=!/-(astra|fable)(?:-|$)/.test(model);
}
function modelControl(key,spec){
  const box=document.createElement('div');box.className='model-controls';
  const modelBox=document.createElement('div');modelBox.className='model-field';
  const label=document.createElement('label');label.htmlFor='model-'+key;label.textContent='Model';
  const model=document.createElement('select');model.id='model-'+key;model.required=true;model.setAttribute('aria-label',key==='fallback'?'Fallback model':key+' model');
  const choices=modelChoices({...loaded,settings:draft},provider,profileFamily(profile)),groups=new Map();
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
function capture(){if(!draft)return;const p=profileMap(draft,profile);for(const tier of tiers){const c=controls.get(tier);p.tiers[tier]={model:selectedModel(c),effort:c.effort.value||null};}
  const c=controls.get('fallback');p.fallbackModel=selectedModel(c);p.fallbackEffort=c.effort.value||null;
  draft.disabledTiers=tiers.filter(t=>!$('tier-'+t).checked);draft.enabled=$('enabled').checked;
  for(const client of ['codex','hermes','claude'])if($('routing-'+client))draft.routing[client]=$('routing-'+client).value;
  draft.classificationMaxChars=Number($('max-chars').value);
}
function updateRouting(){
  $('routing-status').textContent=draft.enabled?'Jev chooses a tier for new tasks.':'Paused · Jev selections use your fallback model.';
  tiers.forEach(t=>{const off=draft.disabledTiers.includes(t);$('row-'+t).classList.toggle('tier-off',off);$('state-'+t).hidden=!off;const c=controls.get(t);c.model.disabled=off;c.effort.disabled=off;c.custom.disabled=off||c.custom.hidden;});
  $('tiers-note').textContent=draft.disabledTiers.length===4?'All tiers are off. Enable a tier for automatic tier routing.':'';
  const fallback=controls.get('fallback');$('fallback-summary').textContent=modelName(selectedModel(fallback))+' · '+(fallback.effort.value||'model default');
}
function renderProvider(){const p=profileMap(draft,profile);controls.clear();$('tiers').replaceChildren();
  tiers.forEach((tier,i)=>{const row=document.createElement('div');row.className='tier-row';row.id='row-'+tier;
    const tag=document.createElement('div');tag.className='tier-tag';
    const name=document.createElement('strong');name.textContent=tier[0]+tier.slice(1).toLowerCase();const caption=document.createElement('p');caption.textContent=captions[i];const state=document.createElement('span');state.id='state-'+tier;state.className='tier-state';state.textContent='Off in all profiles';tag.append(name,caption,state);row.append(tag,modelControl(tier,p.tiers[tier]));$('tiers').append(row);
  });
  $('fallback-controls').replaceChildren(modelControl('fallback',{model:p.fallbackModel,effort:p.fallbackEffort}));
  const info=profileChoices(draft).find(p=>p.id===profile);$('provider-help').textContent=info.description+(provider==='claude'?' Model availability is unverified.':'');$('profile-use').textContent=profile==='claude'?info.command:'Hermes: '+info.command+' · Codex Desktop: '+(profile==='codex'?'Jev':'Jev '+profile[0].toUpperCase()+profile.slice(1));
  updateRouting();
}
function renderGlobal(){
  $('tier-switches').replaceChildren(...tiers.map(tier=>{const label=document.createElement('label');label.className='toggle';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='tier-'+tier;checkbox.checked=!draft.disabledTiers.includes(tier);checkbox.setAttribute('aria-label','Use '+tier+' tier in all profiles');label.append(checkbox,tier[0]+tier.slice(1).toLowerCase());return label;}));
  $('timing-controls').replaceChildren(...['codex','hermes','claude'].map(client=>{const box=document.createElement('div'),cap=loaded.capabilities?.[client];
    const label=document.createElement(cap?.configurable?'label':'strong');label.textContent=cap?.label || client;
    box.append(label);
    if(cap?.configurable){const select=document.createElement('select');select.id='routing-'+client;label.htmlFor=select.id;select.append(option('conversation','Once per conversation'),option('turn','Every human turn'));select.value=draft.routing[client];box.append(select);}
    const note=document.createElement('p');note.className='hint';note.textContent=cap?.note || 'Installation mode unavailable. Reload settings to check.';box.append(note);return box;}));
}
function apply(data){loaded=data;draft=structuredClone(data.settings);$('enabled').checked=draft.enabled;$('max-chars').value=draft.classificationMaxChars;renderGlobal();
  const profiles=profileChoices(draft);if(!profiles.some(p=>p.id===profile))profile='codex';provider=profileProvider(profile);$('provider').replaceChildren(...profiles.map(p=>option(p.id,p.name)));$('provider').value=profile;
  $('classifier').textContent='Task excerpts are sent '+(data.classifier==='openrouter'?'through OpenRouter to TypeSafe / Jev.':'directly to TypeSafe / Jev.');$('key-command').textContent=data.classifier==='openrouter'?'jev-router key --openrouter':'jev-router key';renderProvider();dirty=false;$('save-status').textContent='';$('save-bar').hidden=true;$('settings-form').hidden=false;
}
async function load(){if(busy)return;setBusy(true);try{const r=await fetch('/settings/state',{cache:'no-store',signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Settings unavailable.');apply(data);message(data.catalogUnavailable?'Model catalog unavailable. Saved models are still shown. Check the service, then reload settings.':'',data.catalogUnavailable);}catch(e){message(e.name==='TimeoutError'?'Loading timed out. Try Reload settings.':e.message,true);}finally{setBusy(false);}}
$('provider').addEventListener('change',()=>{capture();profile=$('provider').value;provider=profileProvider(profile);renderProvider();syncDirty();});
$('settings-form').addEventListener('change',event=>{if(['provider','show-ids'].includes(event.target.id)||event.target.id.startsWith('model-')||event.target.id.startsWith('effort-'))return;syncDirty();});
$('show-ids').addEventListener('change',()=>{for(const c of controls.values())renderReasoning(c,c.effort.value);});
$('settings-form').addEventListener('invalid',event=>{for(let p=event.target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;},true);
$('max-chars').addEventListener('input',syncDirty);
$('reload').addEventListener('click',()=>{if(!busy&&(!dirty||window.confirm('Discard unsaved changes and reload?')))load();});
$('reset').addEventListener('click',()=>{if(!busy){apply(loaded);setBusy(false);message('Unsaved changes discarded. Your saved settings are unchanged.');}});
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!dirty)return;capture();
  const problem=profileError(draft);if(problem){profile=problem.profile;provider=profileProvider(profile);$('provider').value=profile;renderProvider();if(problem.field==='fallback')$('fallback-details').open=true;message(problem.message,true);controls.get(problem.field).model.focus();return;}
  const changed=changedSections(loaded.settings,draft).join(', ');
  setBusy(true);
  try{const r=await fetch('/settings/state',{method:'POST',headers:{'content-type':'application/json','x-jev-settings-token':loaded.token},body:JSON.stringify({revision:loaded.revision,settings:draft}),signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Save status unknown. Reload settings to check.');apply(data);
    let result='Saved: '+changed+'. Private backup created.';
    if(data.refreshRequired || data.catalogUnavailable)result+=' Settings are saved, but service details could not refresh. Check the service, then reload settings.';
    else if(data.modelsChanged)result+='\nModel IDs changed: run jev-router refresh-catalog. For local Desktop, restart the app. For SSH, finish active chats, then run jev-router desktop-check and follow its reload guidance.';
    else result+=' New chats use these mappings; existing pinned chats keep their choice.';
    message(result,Boolean(data.refreshRequired || data.catalogUnavailable));await health();
  }catch(e){$('save-status').textContent='Changes need attention';message(e.name==='TimeoutError'?'Save timed out. Reload settings to check whether it completed before retrying.':e.message,true);}finally{setBusy(false);}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function health(){await checkHealth({status:$('health'),details:$('health-detail')});}
$('check-health').addEventListener('click',async()=>{$('check-health').disabled=true;try{await health();}finally{$('check-health').disabled=false;}});
load();health();
