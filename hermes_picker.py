"""Advertise router profiles through Hermes's supported providers.models overlay.
No Hermes code, token stores, or desktop preference databases are modified.
"""
import datetime,json,re,shutil,sys
import manage as m

def section(text,keys):
    start,end=0,len(text)
    for depth,key in enumerate(keys):
        indent=depth*2
        pattern=r'^ {'+str(indent)+r'}(?:'+re.escape(key)+r'|"'+re.escape(key)+r'"|\''+re.escape(key)+r'\'):[^\n]*(?:\n|$)'
        hit=re.search(pattern,text[start:end],re.M)
        if not hit:return None
        first=start+hit.start();body=start+hit.end();stop=end
        for line in re.finditer(r'^([^\n]*)(?:\n|$)',text[body:end],re.M):
            s=line[1]
            if not s.strip() or s.lstrip().startswith('#'):continue
            spaces=len(s)-len(s.lstrip(' '))
            if spaces<=indent and not (depth==2 and s.lstrip().startswith('- ')):
                stop=body+line.start();break
        start,end=body,stop
    return (first,body,end,text[first:body])

def ensure(text,keys,headers):
    hit=section(text,keys)
    if hit:
        value=hit[3].split(':',1)[1].split('#',1)[0].strip()
        if value:
            if value not in ('{}','[]'):raise RuntimeError('Unsupported inline Hermes models/provider block; existing configuration preserved')
            line=hit[3].split(':',1)[0]+':'+(' #'+hit[3].split('#',1)[1] if '#' in hit[3] else '\n')
            headers.append({'keys':keys,'old':hit[3],'installed':line})
            text=text[:hit[0]]+line+text[hit[1]:]
        return text
    parent=section(text,keys[:-1]) if len(keys)>1 else None
    pos=parent[2] if parent else len(text)
    if len(keys)>1 and parent is None:raise RuntimeError('Missing provider parent')
    # An existing key at another indentation/inline parent must not be duplicated.
    if len(keys)==1 and re.search(r'^'+re.escape(keys[0])+r':',text,re.M):raise RuntimeError('Unsupported Hermes provider indentation')
    line='  '*(len(keys)-1)+keys[-1]+':\n'
    prefix='' if pos==0 or text[pos-1]=='\n' else '\n'
    headers.append({'keys':keys,'old':'','installed':line})
    return text[:pos]+prefix+line+text[pos:]

def enable():
    c=m.current_config();journal=m.read_json(m.STATE/'integration.json')
    if not c.get('clients',{}).get('hermes') or not journal.get('active'):return
    p=m.H/'.hermes/config.yaml';old=p.read_text()
    if m.hermes_provider(old)!='openai-codex':return
    expected='http://127.0.0.1:'+str(c['port'])+'/hermes/codex'
    route=m.yaml_model_line(old,'base_url')
    if not route or route[2].split(':',1)[1].strip().strip('"\'')!=expected:raise RuntimeError('Hermes route differs from this proxy; existing configuration preserved')
    if any(x.get('kind')=='yaml-picker' for x in journal.get('changes',[])):return
    text=old;headers=[]
    for keys in [['providers'],['providers','openai-codex'],['providers','openai-codex','models']]:text=ensure(text,keys,headers)
    hit=section(text,['providers','openai-codex','models']);body=text[hit[1]:hit[2]]
    lines=[s for s in body.splitlines() if s.strip() and not s.lstrip().startswith('#')]
    list_mode=bool(lines and lines[0].lstrip().startswith('- ')) or any(h['old'].split(':',1)[-1].strip()=='[]' for h in headers)
    indent=len(lines[0])-len(lines[0].lstrip()) if list_mode and lines else 6
    ids=['gpt-jev-auto']+['gpt-jev-'+f for f in ['luna','sol'] if c.get('variants',{}).get('codex',{}).get(f)]
    added=[]
    for model in ids:
        if re.search(r'^ {'+str(indent if list_mode else 6)+r'}(?:-\s*)?["\']?'+re.escape(model)+r'["\']?(?=\s*:|\s*$)',body,re.M):continue
        added.append(' '*indent+'- '+json.dumps(model)+'\n' if list_mode else '      '+json.dumps(model)+': {}\n')
    if not added:return
    text=text[:hit[2]]+''.join(added)+text[hit[2]:]
    backup=m.STATE/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');backup.mkdir(parents=True,mode=0o700)
    shutil.copy2(p,backup/'hermes-config.yaml');(backup/'hermes-config.yaml').chmod(0o600)
    journal.setdefault('changes',[]).append({'kind':'yaml-picker','path':str(p),'backup':str(backup/'hermes-config.yaml'),'lines':added,'headers':headers})
    m.write(m.STATE/'integration.json',json.dumps(journal,indent=2)+'\n')
    m.write(p,text)
    print('Hermes picker profiles configured; refresh its models or restart Hermes. Backup: '+str(backup))

def restore(text,record):
    conflicts=[]
    hit=section(text,['providers','openai-codex','models'])
    if hit:
        lines=text[hit[1]:hit[2]].splitlines(keepends=True)
        for line in record['lines']:
            if line in lines:lines.remove(line)
            else:conflicts.append('providers.openai-codex.models')
        text=text[:hit[1]]+''.join(lines)+text[hit[2]:]
    for h in reversed(record['headers']):
        hit=section(text,h['keys'])
        if hit and not text[hit[1]:hit[2]].strip() and hit[3]==h['installed']:
            text=text[:hit[0]]+h['old']+text[hit[2]:]
    return text,conflicts

if __name__=='__main__':
    try:enable()
    except Exception:print('Hermes picker setup failed; existing settings and backups retained.',file=sys.stderr);sys.exit(1)
