import {RoutingEngine} from './routing.mjs';
import {readConfig,loadModelCatalog,safeLog} from './settings.mjs';
import {virtualModel} from './native-routing.mjs';
import {randomUUID} from 'node:crypto';

export async function firstRequest({model,prompt='',client='codex',session=randomUUID()},dependencies={}) {
  if(!virtualModel(model))return {model,manual:true};
  const config=dependencies.config || readConfig;
  const engine=new RoutingEngine({config,classifier:dependencies.classifier,logger:()=>{}});
  engine.seedModels((dependencies.catalog || loadModelCatalog)());
  const result=await engine.rewrite({model,input:[{role:'user',content:prompt}],
    tools:[{type:'function',name:'native_chat'}],client_metadata:{thread_id:session}},'codex',client);
  const spec={model:result.body.model,effort:result.body.reasoning?.effort};
  (dependencies.logger || safeLog)({client:client+'-native',state:'native-first-request',model:spec.model,effort:spec.effort,conversation_id:result.receipt.conversation_id});
  return spec;
}
