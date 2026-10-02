const byId=id=>document.getElementById(id);
let recommendedTask='';
fetch('/health').then(r=>r.json()).then(h=>{byId('health').textContent=!h.enabled?'Router disabled':h.keyAvailable?'Key configured · '+h.classifier:'Classifier key missing';}).catch(()=>{byId('health').textContent='Service unavailable';});
byId('advice-form').addEventListener('submit',async event=>{
  event.preventDefault();const task=byId('task').value.trim();if(!task)return;
  byId('ask').disabled=true;byId('ask').textContent='Asking Jev…';byId('error').hidden=true;byId('result').hidden=true;
  try {
    const response=await fetch('/advice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:task,provider:byId('provider').value}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(!response.ok || !result.advice)throw new Error(result.error || 'Jev did not return a recommendation. Keep your current model and try again.');
    const d=result.advice;recommendedTask=task;
    byId('tier').textContent=d.tier+(d.confidence!=null && d.confidence<0.6?' · TENTATIVE':'');
    byId('model').textContent=d.model;
    byId('details').textContent=(d.effort?'Reasoning: '+d.effort:'No reasoning setting required')+' · '+(d.confidence==null?'Explicit task override':Math.round(d.confidence*100)+'% confidence')+' · '+d.latency_ms+' ms';
    byId('caution').textContent=d.confidence!=null && d.confidence<0.6?'Jev is uncertain. Review this suggestion before choosing; it is not a confirmed best model.':'';
    byId('copy').textContent='Copy task';byId('result').hidden=false;
  } catch(error){byId('error').textContent=error.name==='TimeoutError'?'Jev timed out. Keep your current model and try again.':error.message;byId('error').hidden=false;}
  finally{byId('ask').disabled=false;byId('ask').textContent='Ask Jev ↗';}
});
byId('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(recommendedTask);byId('copy').textContent='Task copied';}catch{byId('copy').textContent='Select and copy the task above';}});
