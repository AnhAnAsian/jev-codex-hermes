const $=id=>document.getElementById(id);
const tiers=['FAST','BALANCED','STRONG','LONG'],captions=['Small, familiar tasks','Everyday changes','Difficult debugging','Deep architecture'];
const efforts=['','none','minimal','low','medium','high','xhigh','max','ultra'];
let loaded,draft,provider='codex',dirty=false,busy=false;
function message(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function effortOptions(select,value){select.replaceChildren();for(const e of efforts){const o=document.createElement('option');o.value=e;o.textContent=e||'No effort setting';select.append(o);}select.value=value??'';}
function capture(){if(!draft)return;const p=draft.providers[provider];for(const tier of tiers){p.tiers[tier].model=$('model-'+tier).value.trim();p.tiers[tier].effort=$('effort-'+tier).value||null;}
  p.fallbackModel=$('fallback-model').value.trim();p.fallbackEffort=$('fallback-effort').value||null;
  draft.disabledTiers=tiers.filter(t=>!$('tier-'+t).checked);draft.enabled=$('enabled').checked;
  draft.routing.codex=$('routing-codex').value;draft.routing.hermes=$('routing-hermes').value;draft.classificationMaxChars=Number($('max-chars').value);
}
function renderProvider(){const p=draft.providers[provider];$('tiers').replaceChildren();
  tiers.forEach((tier,i)=>{const row=document.createElement('div');row.className='tier-row';
    const tag=document.createElement('div');tag.className='tier-tag';const toggle=document.createElement('label');toggle.className='toggle';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='tier-'+tier;checkbox.checked=!draft.disabledTiers.includes(tier);
    const name=document.createElement('strong');name.textContent=tier;toggle.append(checkbox,name);const caption=document.createElement('p');caption.textContent=captions[i];tag.append(toggle,caption);
    const label=document.createElement('label');label.textContent='Model';const model=document.createElement('input');model.id='model-'+tier;model.value=p.tiers[tier].model;model.required=true;model.maxLength=120;model.autocomplete='off';model.spellcheck=false;model.setAttribute('list','model-list');label.append(model);
    const reasoning=document.createElement('label');reasoning.textContent='Reasoning';const select=document.createElement('select');select.id='effort-'+tier;effortOptions(select,p.tiers[tier].effort);reasoning.append(select);row.append(tag,label,reasoning);$('tiers').append(row);
  });
  $('fallback-model').value=p.fallbackModel;effortOptions($('fallback-effort'),p.fallbackEffort);
  $('model-list').replaceChildren();const ids=provider==='codex'?loaded.models.map(m=>m.id):[...new Set([...Object.values(p.tiers).map(s=>s.model),p.fallbackModel])];
  for(const id of ids){const option=document.createElement('option');option.value=id;$('model-list').append(option);}
}
function apply(data){loaded=data;draft=structuredClone(data.settings);$('enabled').checked=draft.enabled;$('routing-codex').value=draft.routing.codex;$('routing-hermes').value=draft.routing.hermes;$('max-chars').value=draft.classificationMaxChars;
  $('classifier').textContent='Task excerpts are sent '+(data.classifier==='openrouter'?'through OpenRouter to TypeSafe / Jev.':'directly to TypeSafe / Jev.');renderProvider();dirty=false;$('save-status').textContent='Private backup on every save.';$('settings-form').hidden=false;
}
async function load(){busy=true;$('save').disabled=true;try{const r=await fetch('/settings/state',{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Settings unavailable.');apply(data);message('Private backups are created each time you save.');}catch(e){message(e.message,true);}finally{busy=false;$('save').disabled=false;}}
$('provider').addEventListener('change',()=>{capture();provider=$('provider').value;renderProvider();});
$('settings-form').addEventListener('input',event=>{if(event.target.id==='provider')return;dirty=true;$('save-status').textContent='Unsaved changes';});
$('reload').addEventListener('click',()=>{if(!busy && (!dirty || window.confirm('Discard unsaved changes and reload?')))load();});
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;capture();busy=true;$('save').disabled=true;$('reload').disabled=true;
  try{const r=await fetch('/settings/state',{method:'POST',headers:{'content-type':'application/json','x-jev-settings-token':loaded.token},body:JSON.stringify({revision:loaded.revision,settings:draft})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Settings could not be saved.');apply(data);message(data.modelsChanged?'Saved. Model IDs changed: run jev-router refresh-catalog, then restart Desktop to update its context limits.':'Saved. Private backup created. New chats use your updated mappings.');await health();}catch(e){message(e.message,true);}finally{busy=false;$('save').disabled=false;$('reload').disabled=false;}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function health(){try{const r=await fetch('/health');const h=await r.json();$('health').textContent=!h.ok?'Configuration needs repair':!h.enabled?'Routing paused':h.keyAvailable?'Routing ready · '+h.classifier:'Classifier key missing';}catch{$('health').textContent='Service unavailable';}}
load();health();
