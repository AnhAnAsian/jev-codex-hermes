#!/usr/bin/env python3
"""Only the router-owned configuration fields are changed/restored.

Original client authentication files are never opened. Backups of configuration
stay private and are never emitted to stdout.
"""
import pathlib, os, json, datetime, shutil, re, sys, subprocess, plistlib
H=pathlib.Path.home(); ROOT=pathlib.Path(__file__).resolve().parent
STATE=pathlib.Path(os.environ.get('JEV_SERVICE_HOME',str(H/'.config/jev-router')))
LABEL='ai.typesafe.jev-router.local'; PLIST=H/'Library/LaunchAgents'/f'{LABEL}.plist'
def write(p,text):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=p.with_name(p.name+'.jev-tmp');tmp.write_text(text);tmp.chmod(0o600);tmp.replace(p)
def read_json(p):return json.loads(p.read_text()) if p.exists() else {}
def current_config():return read_json(STATE/'config.json')
def root_line(text,key):
    cutoff=re.search(r'^\s*\[',text,re.M);end=cutoff.start() if cutoff else len(text)
    return re.search(r'^'+re.escape(key)+r'\s*=.*(?:\n|$)',text[:end],re.M)
def toml_set(text,key,value):
    m=root_line(text,key)
    line=key+' = '+json.dumps(value)+'\n' if value is not None else ''
    if m:return text[:m.start()]+line+text[m.end():]
    return line+text if line else text
def yaml_model_line(text,key):
    m=re.search(r'^model:\s*\n',text,re.M)
    if not m:raise RuntimeError('missing model block')
    after=text[m.end():];end=re.search(r'^\S',after,re.M)
    section=after[:end.start()] if end else after
    line=re.search(r'^  '+re.escape(key)+r':.*(?:\n|$)',section,re.M)
    return (m.end()+line.start(),m.end()+line.end(),line.group()) if line else None
def yaml_set(text,key,value):
    m=yaml_model_line(text,key);line='  '+key+': '+json.dumps(value)+'\n' if value is not None else ''
    if m:return text[:m[0]]+line+text[m[1]:]
    start=re.search(r'^model:\s*\n',text,re.M).end();return text[:start]+line+text[start:]
def path_value(d,keys):
    for key in keys:
        if not isinstance(d,dict) or key not in d:return {'present':False}
        d=d[key]
    return {'present':True,'value':d}
def json_set(d,keys,record):
    for key in keys[:-1]:d=d.setdefault(key,{})
    if record['present']:d[keys[-1]]=record['value']
    else:d.pop(keys[-1],None)
def yaml_alias_block(text,name='jev'):
    section=re.search(r'^model_aliases:\s*\n',text,re.M)
    if not section:return None
    end=re.search(r'^\S',text[section.end():],re.M);stop=section.end()+end.start() if end else len(text)
    hit=re.search(r'^  '+re.escape(name)+r':[^\n]*\n(?:^    .*\n|^\s*\n)*',text[section.end():stop],re.M)
    return (section.end()+hit.start(),section.end()+hit.end(),hit.group()) if hit else None

def set_jev_alias(text,block,name='jev'):
    existing=yaml_alias_block(text,name)
    if existing:return text[:existing[0]]+block+text[existing[1]:]
    header=re.search(r'^model_aliases:\s*\n',text,re.M)
    if not block:return text
    if header:return text[:header.end()]+block+text[header.end():]
    return text+('' if text.endswith('\n') else '\n')+'model_aliases:\n'+block

def hermes_provider(text):
    line=yaml_model_line(text,'provider')
    if not line:raise RuntimeError('Hermes requires an explicit supported provider; nothing changed')
    provider=line[2].split(':',1)[1].split(' #',1)[0].strip().strip('"\'')
    if provider not in ('openai-codex','anthropic','claude'):
        raise RuntimeError('Unsupported Hermes provider: use the existing openai-codex or Anthropic provider; nothing changed')
    mode=yaml_model_line(text,'api_mode')
    if mode:
        mode=mode[2].split(':',1)[1].split(' #',1)[0].strip().strip('"\'')
        expected=('codex_responses',) if provider=='openai-codex' else ('anthropic','anthropic_messages','messages')
        if mode not in expected:raise RuntimeError('Unsupported Hermes transport; nothing changed')
    return provider

def activate():
    config=current_config();base=f"http://127.0.0.1:{config['port']}"
    manifest_path=STATE/'integration.json'
    if read_json(manifest_path).get('active'):print('Client integration already enabled.');return
    hermes_enabled=config.get('clients',{}).get('hermes',False)
    claude_enabled=config.get('clients',{}).get('claude',False)
    hermes_text=(H/'.hermes/config.yaml').read_text() if hermes_enabled else ''
    provider=hermes_provider(hermes_text) if hermes_enabled else None
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup=STATE/'backups'/stamp;backup.mkdir(parents=True,mode=0o700)
    changes=[]
    def journal():write(manifest_path,json.dumps({'active':True,'backup':str(backup),'changes':changes},indent=2)+'\n')
    hermes_claude=provider in ('anthropic','claude')
    hermes_route='/hermes/claude' if hermes_claude else '/hermes/codex'
    # Integrate only explicitly enabled clients; Desktop is managed separately.
    plans=[('yaml',H/'.hermes/config.yaml',{'base_url':base+hermes_route,'default':'jev-auto' if hermes_claude else 'gpt-jev-auto','context_length':200000 if hermes_claude else 272000})] if hermes_enabled else []
    for kind,p,fields in plans:
        if not p.exists():continue
        text=p.read_text();saved=backup/(p.parent.name+'-'+p.name);shutil.copy2(p,saved);saved.chmod(0o600)
        updated=text;records=[]
        for key,val in fields.items():
            if kind=='toml':m=root_line(text,key);old=m.group() if m else None;updated=toml_set(updated,key,val)
            else:m=yaml_model_line(text,key);old=m[2] if m else None;updated=yaml_set(updated,key,val)
            records.append({'key':key,'old_line':old,'installed':val})
        changes.append({'kind':kind,'path':str(p),'backup':str(saved),'fields':records})
        journal()
        write(p,updated)
    if hermes_enabled:
        p=H/'.hermes/config.yaml';text=p.read_text()
        if not hermes_claude:
            for name,model in [('jev','gpt-jev-auto'),('jev-luna','gpt-jev-luna'),('jev-sol','gpt-jev-sol')]:
                old_alias=yaml_alias_block(text,name)
                alias='  '+name+':\n    model: "'+model+'"\n    provider: "openai-codex"\n'
                changes.append({'kind':'yaml-alias','name':name,'path':str(p),'old_block':old_alias[2] if old_alias else '', 'installed_block':alias,'had_header':bool(re.search(r'^model_aliases:',text,re.M))})
                journal();text=set_jev_alias(text,alias,name);write(p,text)
    if claude_enabled:
        p=H/'.claude/settings.json';d=read_json(p);saved=backup/'claude-settings.json'
        if p.exists():shutil.copy2(p,saved);saved.chmod(0o600)
        env={'ANTHROPIC_BASE_URL':base+'/claude','ANTHROPIC_MODEL':'jev-auto',
             'ANTHROPIC_CUSTOM_MODEL_OPTION':'jev-auto','ANTHROPIC_CUSTOM_MODEL_OPTION_NAME':'Jev Router',
             'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION':'Automatic routing; TypeSafe receives task text',
             'ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES':'thinking,adaptive_thinking,interleaved_thinking,effort,max_effort',
             'CLAUDE_CODE_MAX_CONTEXT_TOKENS':'200000'}
        records=[]
        for key,val in env.items():
            keys=['env',key];records.append({'keys':keys,'old':path_value(d,keys),'installed':{'present':True,'value':val}})
            json_set(d,keys,{'present':True,'value':val})
        changes.append({'kind':'json','path':str(p),'backup':str(saved),'fields':records})
        journal()
        write(p,json.dumps(d,indent=2)+'\n')
    # Hermes credential-pool rotation and auxiliary clients also use this override.
    if hermes_enabled and not hermes_claude:
        p=H/'.hermes/.env';old=p.read_text() if p.exists() else ''
        saved=backup/'hermes-env'
        if p.exists():shutil.copy2(p,saved);saved.chmod(0o600)
        key='HERMES_CODEX_BASE_URL';m=re.search(r'^'+key+r'=.*(?:\n|$)',old,re.M)
        new_line=key+'='+base+'/hermes/codex\n'
        new=old[:m.start()]+new_line+old[m.end():] if m else old+('' if old.endswith('\n') or not old else '\n')+new_line
        changes.append({'kind':'env','path':str(p),'backup':str(saved),'fields':[{'key':key,'old_line':m.group() if m else None,'installed_line':new_line}]})
        journal();write(p,new)
    if config.get('desktop',{}).get('mode')=='hook-subagent' and config.get('clients',{}).get('codex'):
        p=H/'.codex/hooks.json';d=read_json(p);saved=backup/'codex-hooks.json'
        if p.exists():shutil.copy2(p,saved);saved.chmod(0o600)
        node=shutil.which('node')
        group={'hooks':[{'type':'command','command':'"'+node+'" "'+str(ROOT/'desktop-hook.mjs')+'"','timeout':6,'statusMessage':'Choosing a Jev subagent tier','additionalContextLimit':750}]}
        groups=d.setdefault('hooks',{}).setdefault('UserPromptSubmit',[])
        if group not in groups:groups.append(group)
        changes.append({'kind':'hook','path':str(p),'backup':str(saved),'group':group})
        journal();write(p,json.dumps(d,indent=2)+'\n')
    write(manifest_path,json.dumps({'active':True,'backup':str(backup),'changes':changes},indent=2)+'\n')
    print('Enabled client integration. Private backups: '+str(backup))
    if hermes_enabled:
        from hermes_picker import enable as enable_hermes_picker
        enable_hermes_picker()
def deactivate():
    if read_json(STATE/'native-clients.json').get('active'):
        subprocess.run([sys.executable,str(ROOT/'native_clients.py'),'disable'],check=True)
    if (ROOT/'desktop.py').exists():subprocess.run([sys.executable,str(ROOT/'desktop.py'),'disable'],check=True)
    manifest=read_json(STATE/'integration.json')
    if not manifest.get('active'):print('Client integration already disabled.');return
    conflicts=[]
    for change in manifest['changes']:
        p=pathlib.Path(change['path']);text=p.read_text() if p.exists() else ''
        if change['kind']=='yaml-picker':
            from hermes_picker import restore
            restored,issues=restore(text,change);conflicts.extend(issues);write(p,restored);continue
        if change['kind']=='yaml-alias':
            name=change.get('name','jev');hit=yaml_alias_block(text,name)
            if hit and hit[2]==change['installed_block']:
                text=set_jev_alias(text,change['old_block'],name)
                if not change.get('had_header'):
                    text=re.sub(r'^model_aliases:\s*\n(?=\S|\Z)','',text,flags=re.M)
                write(p,text)
            else:conflicts.append(str(p)+':model_aliases.'+name)
            continue
        if change['kind']=='hook':
            d=read_json(p);groups=d.get('hooks',{}).get('UserPromptSubmit',[])
            d['hooks']['UserPromptSubmit']=[g for g in groups if g!=change['group']]
            write(p,json.dumps(d,indent=2)+'\n');continue
        if change['kind']=='json':
            d=read_json(p)
            for f in change['fields']:
                if path_value(d,f['keys'])==f['installed']:json_set(d,f['keys'],f['old'])
                else:conflicts.append(str(p)+':'+'.'.join(f['keys']))
            if not d.get('env'):d.pop('env',None)
            write(p,json.dumps(d,indent=2)+'\n');continue
        for f in change['fields']:
            key=f['key'];kind=change['kind']
            if kind=='toml':m=root_line(text,key);pos=(m.start(),m.end()) if m else None;actual=m.group() if m else None;expected=key+' = '+json.dumps(f['installed'])+'\n'
            elif kind=='yaml':m=yaml_model_line(text,key);pos=m[:2] if m else None;actual=m[2] if m else None;expected='  '+key+': '+json.dumps(f['installed'])+'\n'
            else:m=re.search(r'^'+re.escape(key)+r'=.*(?:\n|$)',text,re.M);pos=(m.start(),m.end()) if m else None;actual=m.group() if m else None;expected=f['installed_line']
            owned_virtual_default=kind=='yaml' and key=='default' and actual and actual.split(':',1)[1].strip().strip('\"\'') in ('jev-auto','gpt-jev-auto','gpt-jev-luna','gpt-jev-sol')
            if (actual==expected or owned_virtual_default) and pos:text=text[:pos[0]]+(f['old_line'] or '')+text[pos[1]:]
            else:conflicts.append(str(p)+':'+key)
        write(p,text)
    alias_changes=[x for x in manifest['changes'] if x['kind']=='yaml-alias']
    for filename in {x['path'] for x in alias_changes if not x.get('had_header')}:
        p=pathlib.Path(filename);text=p.read_text()
        cleaned=re.sub(r'^model_aliases:\s*\n(?=\S|\Z)','',text,flags=re.M)
        if cleaned!=text:write(p,cleaned)
    manifest['active']=False;write(STATE/'integration.json',json.dumps(manifest,indent=2)+'\n')
    print('Restored previous client routing fields; unrelated settings preserved.')
    if conflicts:print('User-modified fields preserved: '+', '.join(conflicts))
def service_install():
    if sys.platform!='darwin':raise RuntimeError('This host installer supports the detected macOS host only.')
    node=shutil.which('node');d={'Label':LABEL,'ProgramArguments':[node,str(ROOT/'src/service.mjs')],
        'WorkingDirectory':str(ROOT),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':5,
        'EnvironmentVariables':{'PATH':str(H/'.local/bin')+':/opt/homebrew/bin:/usr/bin:/bin','JEV_SERVICE_HOME':str(STATE)},
        'StandardOutPath':str(STATE/'service.stdout.log'),'StandardErrorPath':str(STATE/'service.stderr.log')}
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    if PLIST.exists():shutil.copy2(PLIST,STATE/('previous-launchagent-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S')+'.plist'))
    PLIST.write_bytes(plistlib.dumps(d));PLIST.chmod(0o600)
    # Stderr is deliberately safe: service startup never prints error objects.
    for name in ['service.stdout.log','service.stderr.log']:
        p=STATE/name;p.touch(mode=0o600,exist_ok=True);p.chmod(0o600)
    print('Installed user LaunchAgent: '+str(PLIST))
def main():
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    action=sys.argv[1]
    if action=='install-service':service_install()
    elif action=='enable':activate()
    elif action=='disable':deactivate()
    elif action=='hermes-picker':subprocess.run([sys.executable,str(ROOT/'hermes_picker.py')],check=True)
    elif action in ('desktop-native-enable','desktop-native-disable'):
        subprocess.run([sys.executable,str(ROOT/'native_desktop.py'),action.rsplit('-',1)[1]],check=True)
    elif action=='native-clients-disable':
        subprocess.run([sys.executable,str(ROOT/'native_clients.py'),'disable'],check=True)
    elif action in ('hermes-effort-enable','hermes-effort-disable'):
        subprocess.run([sys.executable,str(ROOT/'native_clients.py'),action.replace('hermes-','')],check=True)
    elif action in ('desktop-enable','desktop-disable','desktop-refresh','desktop-check','desktop-reload'):
        subprocess.run([sys.executable,str(ROOT/'desktop.py'),action.split('-')[1]],check=True)
    elif action=='uninstall':
        deactivate();subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{LABEL}'],capture_output=True)
        PLIST.unlink(missing_ok=True)
        for name in ['jev-router','jev-claude','jev-codex','jev-hermes']:
            p=H/'.local/bin'/name
            if p.exists() and str(ROOT) in p.read_text():p.unlink()
        print('Service and owned commands removed. Source, private key and backups retained for recovery.')
    else:raise RuntimeError('unknown_action')
if __name__=='__main__':
    try:main()
    except Exception as e:print('Configuration action failed: '+type(e).__name__,file=sys.stderr);sys.exit(1)
