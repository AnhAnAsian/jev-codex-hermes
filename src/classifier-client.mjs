// Reuse the upstream SDK without changing its pinned dependency or source.
import {TypeSafeClient} from '../upstream/node_modules/@typesafe-ai/sdk/dist/index.mjs';
import {createJevClient} from '../upstream/src/router.mjs';
import {THRESHOLDS} from '../upstream/src/config.mjs';
export function classifierProvider(config) {
  const provider=config.classifier?.provider || 'typesafe';
  if(!['typesafe','openrouter'].includes(provider))throw new Error('invalid_classifier_provider');
  return provider;
}
export function createClassifierClient(config,key,fetchImpl) {
  if(classifierProvider(config)==='typesafe')return createJevClient(key);
  // Fixed destination prevents config/environment from redirecting the key.
  return new TypeSafeClient({apiKey:key,baseURL:'https://openrouter.ai/api',
    defaultModel:config.classifier?.model || 'jev-1.13',
    timeout:THRESHOLDS.jevTimeoutMs,
    retry:{maxRetries:THRESHOLDS.jevMaxRetries,backoffInitialMs:150,backoffMaxMs:400},
    logLevel:'error',logger:{debug(){},info(){},warn(){},error(){}},
    ...(fetchImpl?{fetch:fetchImpl}:{})});
}
