"""Reversible terminal launcher and Hermes first-turn extension installation."""
import argparse, datetime, hashlib, json, os, pathlib, shlex, shutil, subprocess, sys
from manage import H, ROOT, STATE, read_json, write

RECORD=STATE/'native-clients.json'

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
    for entry in reversed(record.get('files',[])):
        target=pathlib.Path(entry['path'])
        if not target.exists():continue
        if digest(target)!=entry['installedHash']:conflicts.append(str(target));continue
        if entry['existed']:
            shutil.copy2(entry['backup'],target);target.chmod(entry['mode'])
        else:target.unlink()
    record.update(active=bool(conflicts),conflicts=conflicts);write(RECORD,json.dumps(record,indent=2)+'\n')
    if conflicts:print('User changes preserved; restoration conflicts: '+', '.join(conflicts))
    else:print('Previous Hermes and CLI setup restored. Restart Hermes to apply.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['enable','disable'])
    p.add_argument('--hermes-root',type=pathlib.Path);p.add_argument('--hermes-python',type=pathlib.Path);p.add_argument('--hermes-source',type=pathlib.Path);p.add_argument('--codex')
    a=p.parse_args()
    if a.action=='disable':disable()
    elif not a.hermes_root or not a.hermes_python:p.error('Hermes runtime root and Python are required')
    else:enable(a.hermes_root,a.hermes_python,a.hermes_source,a.codex)
