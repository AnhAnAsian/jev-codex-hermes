#!/usr/bin/env python3
"""Reversible supported Codex provider/catalog setup; never opens auth stores."""
import pathlib,json,copy,datetime,shutil,re,tomllib
from manage import STATE,H,ROOT,write,root_line,toml_set,read_json
RECORD=STATE/'desktop-picker.json';CONFIG=H/'.codex/config.toml';CATALOG=STATE/'desktop-models.json'
def provider_block(port):
    return '\n[model_providers.jev]\nname = "Jev Router"\nbase_url = "http://127.0.0.1:'+str(port)+'/codex"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n'
def refresh_catalog():
    router=read_json(STATE/'config.json');models=read_json(H/'.codex/models_cache.json')['models']
    source=next(m for m in models if m['slug']=='gpt-6.1-sol');virtual=[]
    for family,label,slug in [(None,'Jev','gpt-jev-auto'),('luna','Jev Luna','gpt-jev-luna'),('sol','Jev Sol','gpt-jev-sol')]:
        mapping=router['providers']['codex'] if family is None else router.get('variants',{}).get('codex',{}).get(family)
        if mapping is None:continue
        template=copy.deepcopy(source)
        template.update(slug=slug,display_name=label,description=('Only '+family+' models. ' if family else '')+'Jev selects a tier once per conversation; manual tier overrides remain available.',visibility='list',supported_in_api=True,priority=len(virtual),upgrade=None,availability_nux=None,default_reasoning_level='low')
        template['context_window']=min(m['context_window'] for m in models if m['slug'] in {spec['model'] for spec in mapping['tiers'].values()})
        virtual.append(template)
    write(CATALOG,json.dumps({'models':virtual+models},indent=2)+'\n')

def remove_provider(text,record):
    parsed=tomllib.loads(text).get('model_providers',{}).get('jev')
    if parsed is None:return text,False
    if parsed!=record['provider']:return text,True
    # TOML parsing establishes ownership; table headers establish the exact span.
    headers=list(re.finditer(r'^\s*\[[^\n]+?\][ \t]*(?:#[^\n]*)?$',text,re.M))
    target=next((i for i,m in enumerate(headers) if re.match(r'^\s*\[model_providers\.jev\]',m.group())),None)
    if target is None:return text,True
    start=headers[target].start();end=headers[target+1].start() if target+1<len(headers) else len(text)
    return text[:start]+text[end:],False

def enable():
    if read_json(RECORD).get('conflicts'):raise RuntimeError('desktop_restore_conflicts_pending')
    if read_json(RECORD).get('active'):print('Desktop picker integration already enabled.');return
    router=read_json(STATE/'config.json');original=CONFIG.read_text();parsed=tomllib.loads(original)
    if 'jev' in parsed.get('model_providers',{}):raise RuntimeError('existing_jev_provider_not_owned')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');backup=STATE/'backups'/stamp;backup.mkdir(parents=True,mode=0o700)
    for p in [CONFIG,STATE/'config.json']:
        saved=backup/p.name;shutil.copy2(p,saved);saved.chmod(0o600)
    refresh_catalog()
    fields=[];updated=original
    for key,value in {'model_provider':'jev','model_catalog_json':str(CATALOG)}.items():
        hit=root_line(original,key);fields.append({'key':key,'old_line':hit.group() if hit else '', 'installed':value});updated=toml_set(updated,key,value)
    block=provider_block(router['port']);updated+=block;tomllib.loads(updated)
    record={'active':True,'backup':str(backup),'fields':fields,'block':block,'provider':tomllib.loads(block)['model_providers']['jev']}
    write(RECORD,json.dumps(record,indent=2)+'\n');write(CONFIG,updated)
    router.setdefault('routing',{})['codex']='conversation';router.setdefault('desktop',{})['mode']='proxy-picker';write(STATE/'config.json',json.dumps(router,indent=2)+'\n')
    print('Desktop Jev provider/catalog installed. Restart Desktop. Backup: '+str(backup))
def disable():
    record=read_json(RECORD)
    if not record.get('active'):return
    text=CONFIG.read_text();parsed=tomllib.loads(text);conflicts=[]
    for field in record['fields']:
        hit=root_line(text,field['key'])
        if hit and parsed.get(field['key'])==field['installed']:text=text[:hit.start()]+field['old_line']+text[hit.end():]
        elif (hit.group() if hit else '')!=field['old_line']:conflicts.append(field['key'])
    if parsed.get('model_providers',{}).get('jev')==record['provider'] and record['block'] in text:text=text.replace(record['block'],'',1)
    else:
        text,conflict=remove_provider(text,record)
        if conflict:conflicts.append('model_providers.jev')
    if parsed.get('model') in ('gpt-jev-auto','gpt-jev-luna','gpt-jev-sol','jev-auto'):
        original=tomllib.loads((pathlib.Path(record['backup'])/'config.toml').read_text())
        for key in ('model','model_reasoning_effort'):
            text=toml_set(text,key,original.get(key))
    tomllib.loads(text);write(CONFIG,text)
    router=read_json(STATE/'config.json');router.setdefault('desktop',{})['mode']='advice-only';write(STATE/'config.json',json.dumps(router,indent=2)+'\n')
    record['active']=bool(conflicts);record['conflicts']=conflicts;write(RECORD,json.dumps(record,indent=2)+'\n')
    print('Desktop restored to its previous provider/catalog. Restart Desktop.')
    if conflicts:print('User-modified fields preserved: '+', '.join(conflicts))
if __name__=='__main__':
    import sys
    try:
        if sys.argv[1]=='enable':enable()
        elif sys.argv[1]=='disable':disable()
        elif sys.argv[1]=='refresh':refresh_catalog()
        else:raise RuntimeError('unknown_action')
    except Exception:print('Desktop configuration action failed; original backup is retained.',file=sys.stderr);sys.exit(1)
