"""Reversible terminal launcher and Hermes first-turn extension installation."""
import argparse, datetime, hashlib, json, os, pathlib, shlex, shutil, subprocess, sys
from manage import H, ROOT, STATE, read_json, write

RECORD=STATE/'native-clients.json'

def effort_changes(root):
    """Prepare all edits before writing; refuse changed upstream surfaces."""
    root=pathlib.Path(root)
    helper=root/'agent/chat_completion_helpers.py'
    adapter=root/'agent/codex_responses_adapter.py'
    content=helper.read_text()
    start=content.index('def _build_codex_kwargs(')
    end=content.index('\ndef _build_chat_completions_kwargs(',start)
    block=content[start:end]
    needle='    return agent._get_transport().build_kwargs(model=agent.model,\n'
    tail='        context_management=context_management, text_verbosity=getattr(agent, "text_verbosity", None))\n'
    if block.count(needle)!=1 or block.count(tail)!=1 or 'apply_effort_updates' in content:
        raise RuntimeError('hermes_effort_builder_surface_changed')
    block=block.replace(needle,'    api_kwargs = agent._get_transport().build_kwargs(model=agent.model,\n')
    block=block.replace(tail,tail+'    from agent.effort_cache import apply_effort_updates\n    return apply_effort_updates(agent, api_kwargs)\n')
    changes={helper:content[:start]+block+content[end:]}
    content=adapter.read_text()
    needle='_PREFLIGHT_ITEM_HANDLERS: Dict[str, Callable[..., Optional[Dict[str, Any]]]] = {\n'
    if content.count(needle)!=1 or 'preflight_update' in content:
        raise RuntimeError('hermes_effort_preflight_surface_changed')
    changes[adapter]=content.replace(needle,'from agent.effort_cache import preflight_update\n\n'+needle+'    "configuration_update": preflight_update,\n')
    commands=root/'hermes_cli/cli_commands_mixin.py'
    content=commands.read_text()
    needle='        _retire_agent(self)  # Force agent re-init with new reasoning config\n'
    if content.count(needle)!=1 or 'update_live_reasoning' in content:
        raise RuntimeError('hermes_effort_command_surface_changed')
    changes[commands]=content.replace(needle,'        from agent.effort_cache import update_live_reasoning\n        if not update_live_reasoning(self, parsed):\n            _retire_agent(self)  # Existing behavior for unsupported runtimes\n')
    changes[root/'agent/effort_cache.py']=(ROOT/'hermes-native/effort_cache.py').read_text()
    for target,text in changes.items():compile(text,str(target),'exec')
    return changes

def enable_effort_updates():
    record=read_json(RECORD)
    if not record.get('active'):raise RuntimeError('native_clients_not_installed')
    if record.get('effortCacheActive'):raise RuntimeError('hermes_effort_cache_already_installed')
    roots=list(dict.fromkeys(filter(None,[record.get('hermesRoot'),record.get('hermesSource')])))
    if not roots:raise RuntimeError('hermes_runtime_roots_missing')
    changes={}
    for root in roots:changes.update(effort_changes(root))
    for target in changes:
        if any(entry['path']==str(target) for entry in record['files']):
            raise RuntimeError('hermes_effort_file_already_owned')
        if target.name=='effort_cache.py' and target.exists():
            raise RuntimeError('hermes_effort_module_collision')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup=STATE/'backups'/('hermes-effort-'+stamp);backup.mkdir(parents=True,mode=0o700)
    record['effortCacheActive']=True
    write(RECORD,json.dumps(record,indent=2)+'\n')
    try:
        for target,content in changes.items():
            entry={'path':str(target),'existed':target.exists(),'effortCache':True}
            if target.exists():
                entry['backup']=str(backup/(str(len(record['files']))+'-'+target.name))
                shutil.copy2(target,entry['backup']);pathlib.Path(entry['backup']).chmod(0o600)
                entry['mode']=target.stat().st_mode&0o777
            entry['installedHash']=hashlib.sha256(content.encode()).hexdigest()
            record['files'].append(entry);write(RECORD,json.dumps(record,indent=2)+'\n')
            write(target,content);target.chmod(entry.get('mode',0o600))
    except BaseException:
        disable_effort_updates();raise
    print('Hermes cache-preserving effort updates installed. Restart Hermes. Backup: '+str(backup))

def disable_effort_updates():
    record=read_json(RECORD);kept=[];conflicts=[]
    # Keep the extension as a unit when a user edited a dependent core file;
    # removing its imported module would break the preserved user-edited file.
    for entry in record.get('files',[]):
        if not entry.get('effortCache'):continue
        target=pathlib.Path(entry['path'])
        if target.exists() and digest(target)!=entry['installedHash']:
            if entry.get('backup') and digest(target)==digest(pathlib.Path(entry['backup'])):continue
            conflicts.append(str(target))
    if conflicts:
        record.update(effortCacheActive=True,effortCacheConflicts=conflicts)
        write(RECORD,json.dumps(record,indent=2)+'\n')
        print('User edits preserved; effort extension retained: '+', '.join(conflicts));return
    for entry in reversed(record.get('files',[])):
        if not entry.get('effortCache'):
            kept.append(entry);continue
        target=pathlib.Path(entry['path'])
        if not target.exists():continue
        if digest(target)!=entry['installedHash'] and not (entry.get('backup') and digest(target)==digest(pathlib.Path(entry['backup']))):
            conflicts.append(str(target));kept.append(entry);continue
        if entry['existed']:
            shutil.copy2(entry['backup'],target);target.chmod(entry['mode'])
        else:target.unlink()
    record.update(files=list(reversed(kept)),effortCacheActive=bool(conflicts),effortCacheConflicts=conflicts)
    write(RECORD,json.dumps(record,indent=2)+'\n')
    if conflicts:print('User edits preserved; effort restoration conflicts: '+', '.join(conflicts))
    else:print('Hermes effort-update extension removed. Restart Hermes.')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def endpoint_lines(text, expected=None):
    import re
    result=[]
    for line in text.splitlines(keepends=True):
        match=re.match(r'^\s*(?:export\s+)?HERMES_CODEX_BASE_URL\s*=\s*(.*)',line)
        if not match:continue
        try:values=shlex.split(match[1],comments=True)
        except ValueError:continue
        if expected is None or values==[expected]:result.append(line)
    return result

def remove_env_endpoint(path,expected,record,journal):
    if not path.is_file():return
    original=path.read_text();lines=endpoint_lines(original,expected)
    if not lines:return
    entry={'path':str(path),'lines':lines,'mode':path.stat().st_mode&0o777}
    record.setdefault('envChanges',[]).append(entry);journal()
    for line in lines:original=original.replace(line,'',1)
    write(path,original);path.chmod(entry['mode'])

def enable(hermes_root, hermes_python, hermes_source=None, codex=None):
    previous=read_json(RECORD)
    if previous.get('active'): raise RuntimeError('native_clients_already_installed')
    node=shutil.which('node'); python=shutil.which('python3')
    command=H/'.local/bin/codex'
    if not node or not python or not command.is_symlink(): raise RuntimeError('expected_codex_launcher_symlink_missing')
    original=os.readlink(command); real=str(command.resolve())
    terminal=read_json(STATE/'native-desktop.json')
    if not terminal.get('realCatalog'): raise RuntimeError('native_catalog_missing')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup=STATE/'backups'/('native-clients-'+stamp);backup.mkdir(parents=True,mode=0o700)
    record={'active':True,'backup':str(backup),'files':[],'configs':[],'codex':{'path':str(command),'symlink':original},'conflicts':[],
            'hermesRoot':str(hermes_root),'hermesPython':str(hermes_python)}
    if hermes_source:record['hermesSource']=str(hermes_source)
    def journal():write(RECORD,json.dumps(record,indent=2)+'\n')
    def install_file(target,content,mode=0o600):
        target=pathlib.Path(target)
        entry={'path':str(target),'existed':target.exists()}
        if target.exists():
            entry['backup']=str(backup/(str(len(record['files']))+'-'+target.name));shutil.copy2(target,entry['backup'])
            pathlib.Path(entry['backup']).chmod(0o600);entry['mode']=target.stat().st_mode&0o777
        entry['installedHash']=hashlib.sha256(content.encode()).hexdigest()
        record['files'].append(entry);journal();write(target,content);target.chmod(mode)
    journal()
    try:
        for root in dict.fromkeys(filter(None,[hermes_root,hermes_source])):
            root=pathlib.Path(root)
            turn=root/'agent/turn_context.py';plugins=root/'hermes_cli/plugins.py'
            if not turn.is_file() or not plugins.is_file():raise RuntimeError('hermes_extension_surface_missing')
            content=turn.read_text();needle='    agent._restore_primary_runtime()\n'
            if content.count(needle)!=1 or 'resolve_session_model(agent,' in content:raise RuntimeError('hermes_turn_surface_changed')
            content=content.replace(needle,needle+'    from agent.turn_model_routing import resolve_session_model\n    resolve_session_model(agent, user_message, conversation_history)\n')
            install_file(turn,content)
            content=plugins.read_text();needle='VALID_HOOKS: Set[str] = {\n'
            if content.count(needle)!=1:raise RuntimeError('hermes_hook_surface_changed')
            content=content.replace(needle,needle+'    "resolve_session_model",\n')
            content=content.replace('SHELL_UNSUPPORTED_HOOKS: Set[str] = {','SHELL_UNSUPPORTED_HOOKS: Set[str] = {"resolve_session_model", ')
            install_file(plugins,content)
            install_file(root/'agent/turn_model_routing.py',(ROOT/'hermes-native/turn_model_routing.py').read_text())
            session=root/'hermes_cli/cli_session_mixin.py'
            if session.exists():
                content=session.read_text();needle='    if not _config_model or _config_model == getattr(cli, "model", None):\n'
                if content.count(needle)!=1:raise RuntimeError('hermes_session_reset_surface_changed')
                content=content.replace(needle,'    if not _config_model or (_config_model == getattr(cli, "model", None) and (getattr(cli, "agent", None) is None or _config_model == getattr(cli.agent, "model", None))):\n')
                install_file(session,content)
        plugin=H/'.hermes/plugins/jev-first-request'
        if plugin.exists():raise RuntimeError('hermes_plugin_collision')
        for name in ['__init__.py','plugin.yaml']:
            install_file(plugin/name,(ROOT/'hermes-native/jev-first-request'/name).read_text())
        install_file(plugin/'installation.json',json.dumps({'node':node,'decision':str(ROOT/'native-decision.mjs'),'config':str(STATE/'config.json')})+'\n')
        # Hermes owns YAML writes; round-trip through its public writer preserves comments.
        for cfg in [H/'.hermes/config.yaml',*(H/'.hermes/profiles').glob('*/config.yaml')]:
            if not cfg.exists():continue
            program='''import json,sys,pathlib\nfrom hermes_cli.config import read_user_config_raw,atomic_config_write\np=pathlib.Path(sys.argv[1]);c=read_user_config_raw(p);m=c.get("model",{});expected=sys.argv[2];result={"changed":False,"pluginAdded":False}\nif m.get("provider")=="openai-codex":\n if m.get("base_url")==expected: m.pop("base_url");result["changed"]=True\n enabled=c.get("plugins",{}).get("enabled")\n if isinstance(enabled,list) and "jev-first-request" not in enabled: enabled.append("jev-first-request");result["pluginAdded"]=True\n if any(result.values()): atomic_config_write(p,c)\nprint(json.dumps(result))\n'''
            copy=backup/('hermes-'+hashlib.sha256(str(cfg).encode()).hexdigest()[:10]+'.yaml');shutil.copy2(cfg,copy);copy.chmod(0o600)
            expected='http://127.0.0.1:'+str(read_json(STATE/'config.json')['port'])+'/hermes/codex'
            entry={'path':str(cfg),'baseUrl':expected,'backup':str(copy),'changed':True}
            record['configs'].append(entry);journal()
            result=subprocess.run([str(hermes_python),'-c',program,str(cfg),expected],cwd=hermes_root,capture_output=True,text=True,check=True)
            entry.update(json.loads(result.stdout));journal()
        expected='http://127.0.0.1:'+str(read_json(STATE/'config.json')['port'])+'/hermes/codex'
        for envfile in [H/'.hermes/.env',*(H/'.hermes/profiles').glob('*/.env')]:
            remove_env_endpoint(envfile,expected,record,journal)
        terminal.update(realCli=codex or terminal['realCli'],python=python,launcher=real,active=True)
        install_file(STATE/'native-terminal.json',json.dumps(terminal,indent=2)+'\n')
        shim='#!/bin/sh\nexec '+shlex.quote(node)+' '+shlex.quote(str(ROOT/'native-terminal.mjs'))+' "$@"\n'
        record['codex']['installedHash']=hashlib.sha256(shim.encode()).hexdigest();journal()
        command.unlink();write(command,shim);command.chmod(0o755)
        # Minimal older/test trees may omit this Responses extension surface.
        if all((pathlib.Path(root)/'agent/chat_completion_helpers.py').is_file()
               for root in dict.fromkeys(filter(None,[hermes_root,hermes_source]))):
            enable_effort_updates()
    except BaseException:
        disable();raise
    print('Native routing installed for Hermes and terminal Codex. Backup: '+str(backup))

def disable():
    record=read_json(RECORD)
    if not record.get('active'):return
    conflicts=[]
    command=pathlib.Path(record['codex']['path']);owned=record['codex'].get('installedHash')
    if owned and command.is_file() and not command.is_symlink() and digest(command)==owned:
        command.unlink();command.symlink_to(record['codex']['symlink'])
    elif not command.is_symlink() or os.readlink(command)!=record['codex']['symlink']:conflicts.append(str(command))
    for entry in record.get('configs',[]):
        if not entry.get('changed') and not entry.get('pluginAdded'):continue
        program='''import pathlib,sys,json\nfrom hermes_cli.config import read_user_config_raw,atomic_config_write\ne=json.loads(sys.argv[1]);p=pathlib.Path(e["path"]);c=read_user_config_raw(p);m=c.get("model",{});conflict=False\nif e.get("changed"):\n if m.get("provider")=="openai-codex" and not m.get("base_url"):m["base_url"]=e["baseUrl"]\n elif m.get("base_url")!=e["baseUrl"]:conflict=True\nif e.get("pluginAdded"):\n enabled=c.get("plugins",{}).get("enabled")\n if isinstance(enabled,list): c["plugins"]["enabled"]=[x for x in enabled if x!="jev-first-request"]\natomic_config_write(p,c)\nsys.exit(2 if conflict else 0)\n'''
        r=subprocess.run([record['hermesPython'],'-c',program,json.dumps(entry)],cwd=record['hermesRoot'],capture_output=True)
        if r.returncode:conflicts.append(entry['path'])
    for entry in record.get('envChanges',[]):
        p=pathlib.Path(entry['path']);text=p.read_text() if p.exists() else ''
        current=endpoint_lines(text)
        if current:
            if current!=entry['lines']:conflicts.append(str(p)+':HERMES_CODEX_BASE_URL')
            continue
        write(p,''.join(entry['lines'])+text);p.chmod(entry['mode'])
    effort_conflicts=[]
    for entry in record.get('files',[]):
        target=pathlib.Path(entry['path'])
        if entry.get('effortCache') and target.exists() and digest(target)!=entry['installedHash']:
            effort_conflicts.append(str(target))
    conflicts.extend(effort_conflicts)
    for entry in reversed(record.get('files',[])):
        if effort_conflicts and entry.get('effortCache'):continue
        target=pathlib.Path(entry['path'])
        if not target.exists():continue
        if digest(target)!=entry['installedHash']:conflicts.append(str(target));continue
        if entry['existed']:
            shutil.copy2(entry['backup'],target);target.chmod(entry['mode'])
        else:target.unlink()
    record.update(active=bool(conflicts),conflicts=conflicts,effortCacheActive=bool(effort_conflicts));write(RECORD,json.dumps(record,indent=2)+'\n')
    if conflicts:print('User changes preserved; restoration conflicts: '+', '.join(conflicts))
    else:print('Previous Hermes and CLI setup restored. Restart Hermes to apply.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['enable','disable','effort-enable','effort-disable'])
    p.add_argument('--hermes-root',type=pathlib.Path);p.add_argument('--hermes-python',type=pathlib.Path);p.add_argument('--hermes-source',type=pathlib.Path);p.add_argument('--codex')
    a=p.parse_args()
    if a.action=='disable':disable()
    elif a.action=='effort-enable':enable_effort_updates()
    elif a.action=='effort-disable':disable_effort_updates()
    elif not a.hermes_root or not a.hermes_python:p.error('Hermes runtime root and Python are required')
    else:enable(a.hermes_root,a.hermes_python,a.hermes_source,a.codex)
