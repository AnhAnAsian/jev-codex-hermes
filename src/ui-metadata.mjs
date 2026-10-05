import fs from 'node:fs';
import path from 'node:path';

// Installation journals describe configured modes, not live client connectivity.
// Never expose their paths, backups, commands or other private fields to the UI.
function nativeClientsActive(directory) {
  try {return JSON.parse(fs.readFileSync(path.join(directory,'native-clients.json'),'utf8')).active===true;}
  catch(error) {return error.code==='ENOENT'?false:null;}
}
export function routingCapabilities(config,directory) {
  const nativeClients=nativeClientsActive(directory);
  const desktop=config.desktop?.mode || 'proxy-picker';
  const nativeDesktop=desktop==='native-first';
  const proxyDesktop=desktop==='proxy-picker';
  const codexKnown=nativeClients!==null && ['native-first','proxy-picker','hook-subagent','advice-only'].includes(desktop);
  const codexLabel=proxyDesktop && !nativeClients?'Codex Desktop / CLI':proxyDesktop?'Codex Desktop':!nativeClients?'Codex CLI':'Codex Desktop / CLI';
  return {
    codex:{configurable:config.clients.codex && codexKnown && (proxyDesktop || !nativeClients),
      label:codexLabel,
      note:!config.clients.codex?'Codex routing is not enabled.':!codexKnown?'Codex installation mode could not be verified.':
        [nativeDesktop?'Codex Desktop chooses once per chat.':desktop==='hook-subagent'?'Desktop uses task hooks.':desktop==='advice-only'?'Desktop uses advice only.':'',
          nativeClients?'Codex CLI chooses once per chat.':''].filter(Boolean).join(' ') || 'Choose when proxy chats are classified.'},
    hermes:{configurable:config.clients.hermes && nativeClients!==null,
      label:nativeClients?'Hermes · Claude':'Hermes',
      note:!config.clients.hermes?'Hermes routing is not enabled.':nativeClients===null?'Hermes installation mode could not be verified.':
        nativeClients?'Hermes Codex chooses once per chat. This control applies to Hermes Claude proxy chats.':'Choose when proxy chats are classified.'},
    claude:{configurable:config.clients.claude,label:'Claude Code',
      note:config.clients.claude?'Choose when proxy chats are classified.':'Claude Code routing is not enabled.'}
  };
}

export function classificationMetadata(config) {
  return {classifier:config.classifier?.provider || 'typesafe',classificationMaxChars:config.classificationMaxChars};
}
