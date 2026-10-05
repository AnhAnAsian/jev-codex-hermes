export function healthPresentation(health,httpOk=true) {
  if(!health)return {label:'Unavailable',detail:'The local service could not be reached. Check that Jev is running, then try again.',warning:true};
  if(health.config_state==='last-valid')return {label:'Needs attention',detail:'Configuration needs repair. Jev is using its last valid settings. Run jev-router doctor, then check again.',warning:true};
  if(!httpOk || !health.ok)return {label:'Unavailable',detail:'The local service could not confirm its status. Check that Jev is running, then try again.',warning:true};
  if(!health.enabled)return {label:'Paused',detail:'Automatic routing is paused. Jev selections use their fallback model.',warning:false};
  if(!health.keyAvailable)return {label:'Needs attention',detail:'Classifier key missing. Open Connection details in Settings to configure it.',warning:true};
  return {label:'Ready',detail:'Local service ready. Classification uses '+(health.classifier==='openrouter'?'OpenRouter → TypeSafe / Jev.':'TypeSafe / Jev directly.'),warning:false};
}
export function privacyNotice(metadata) {
  if(!['openrouter','typesafe'].includes(metadata?.classifier) || !Number.isInteger(metadata.classificationMaxChars))return null;
  const destination=metadata.classifier==='openrouter'?'OpenRouter and TypeSafe / Jev':'TypeSafe / Jev directly';
  return 'Clicking Ask Jev sends up to '+metadata.classificationMaxChars.toLocaleString('en-US')+' characters of your task to '+destination+'. Task text is not saved in router logs.';
}
export async function checkHealth({status,details,onUpdate=()=>{}}) {
  let data=null,httpOk=false;
  try {const response=await fetch('/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});data=await response.json();httpOk=response.ok;}
  catch {}
  const state=healthPresentation(data,httpOk);
  status.textContent=state.label;status.classList.toggle('warning',state.warning);status.title=state.detail;
  if(details){details.textContent=state.detail;details.hidden=!state.warning;}
  onUpdate(data,httpOk);
  return data;
}
