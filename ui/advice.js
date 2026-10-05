import {checkHealth,privacyNotice} from './status.js';
const byId=id=>document.getElementById(id);
let recommendedTask='',disclosure=null,busy=false;
function showPrivacy(data){const notice=privacyNotice(data);disclosure=notice?{classifier:data.classifier,classificationMaxChars:data.classificationMaxChars}:null;byId('privacy').textContent=notice || 'Classification settings unavailable. Check the service before sending your task.';byId('ask').disabled=busy||!disclosure;}
async function health(){return checkHealth({status:byId('health'),details:byId('health-detail'),onUpdate:data=>showPrivacy(data)});}
byId('check-health').addEventListener('click',async()=>{byId('check-health').disabled=true;try{await health();}finally{byId('check-health').disabled=false;}});
health();
byId('advice-form').addEventListener('submit',async event=>{
  event.preventDefault();const task=byId('task').value.trim();if(!task||busy||!disclosure)return;
  busy=true;
  byId('ask').disabled=true;byId('ask').textContent='Asking Jev…';byId('error').hidden=true;byId('result').hidden=true;
  try {
    const response=await fetch('/advice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:task,provider:byId('provider').value,disclosure}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(result.metadataChanged)showPrivacy(result);if(!response.ok || !result.advice)throw new Error(result.error || 'Jev did not return a recommendation. Keep your current model and try again.');
    const d=result.advice;recommendedTask=task;
    byId('tier').textContent=d.tier+(d.confidence!=null && d.confidence<0.6?' · TENTATIVE':'');
    byId('model').textContent=d.model;
    byId('details').textContent=(d.effort?'Reasoning: '+d.effort:'No reasoning setting required')+' · '+(d.confidence==null?'Explicit task override':Math.round(d.confidence*100)+'% confidence')+' · '+d.latency_ms+' ms';
    byId('caution').textContent=d.confidence!=null && d.confidence<0.6?'Jev is uncertain. Review this suggestion before choosing; it is not a confirmed best model.':'';
    byId('copy').textContent='Copy task';byId('result').hidden=false;
  } catch(error){byId('error').textContent=error.name==='TimeoutError'?'Jev timed out. Keep your current model and try again.':error.message;byId('error').hidden=false;}
  finally{busy=false;byId('ask').disabled=!disclosure;byId('ask').textContent='Ask Jev ↗';}
});
byId('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(recommendedTask);byId('copy').textContent='Task copied';}catch{byId('copy').textContent='Select and copy the task above';}});
