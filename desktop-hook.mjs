#!/usr/bin/env node
import {readConfig} from './src/settings.mjs';
try {
  let raw='';for await(const data of process.stdin){raw+=data;if(raw.length>65536)process.exit(0);}
  const input=JSON.parse(raw);
  if(input.hook_event_name!=='UserPromptSubmit' || !input.prompt)process.exit(0);
  const c=readConfig();
  if(!c.enabled || input.model==='jev-auto')process.exit(0);
  const r=await fetch(`http://127.0.0.1:${c.port}/desktop/decision`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({prompt:input.prompt,session_id:input.session_id,turn_id:input.turn_id,model:input.model}),signal:AbortSignal.timeout(4500)});
  const {decision:d}=await r.json();if(!d)process.exit(0);
  const context=`Jev selected ${d.tier}: ${d.model}, reasoning effort ${d.effort}. This is the installed Desktop subagent fallback; the parent model has not changed. `+
    `For the current task, delegate implementation or analysis to one subagent using model ${d.model} and reasoning_effort ${d.effort}, with fork_turns="none" when the spawn tool permits model overrides. Include the task and the necessary workspace context. `+
    `Keep the parent for coordination, permissions, Computer Use, and the final response. Avoid recursive delegation. If the user requested no delegation, explicitly chose a parent model, or the needed tools are only available to the parent, preserve that choice and do the work in the parent. `+
    `If a tool cannot set both model and reasoning effort, state that limitation instead of claiming the tier was served. An actual child-model response or session metadata must confirm routing.`;
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:context}})+'\n');
} catch { /* Fail open, including missing key, stopped service, invalid config. */ }
