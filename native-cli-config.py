"""Read only non-secret effective CLI routing settings."""
import hashlib, json, os, pathlib, re, sqlite3, sys, tomllib

args=json.loads(sys.argv[1]); home=pathlib.Path(os.environ.get('CODEX_HOME') or pathlib.Path.home()/'.codex')
try: cfg=tomllib.loads((home/'config.toml').read_text())
except FileNotFoundError: cfg={}
profile=None; overrides={}; command=None; positional=[]; i=0; cwd=os.getcwd(); resume_index=None
value_options={'-c','--config','-m','--model','-p','--profile','-C','--cd','-s','--sandbox','-a','--ask-for-approval','--output-schema','-o','--output-last-message','-i','--image','--enable','--disable','--local-provider','--remote','--remote-auth-token-env','--color','--add-dir','--title'}
commands={'exec','e','resume','fork','review','login','logout','mcp','mcp-server','app-server','completion','sandbox','debug','apply','features','help','cloud'}
while i<len(args):
    arg=args[i]; key=arg.split('=',1)[0]
    joined=len(arg)>2 and arg[:2] in {'-c','-m','-p','-C','-s','-a','-i','-o'}
    if joined:key=arg[:2]
    if arg=='--':
        positional.extend(args[i+1:]);break
    if arg=='-': positional.append(arg)
    elif key in value_options:
        if joined:value=arg[2:].removeprefix('=')
        elif '=' in arg: value=arg.split('=',1)[1]
        else:
            i+=1; value=args[i] if i<len(args) else ''
        if key in {'-p','--profile'}: profile=value
        if key in {'-m','--model'}: overrides['model']=value
        if key in {'-C','--cd'}: cwd=str(pathlib.Path(value).expanduser().resolve())
        if key in {'-c','--config'} and '=' in value:
            name,raw=value.split('=',1)
            if name in {'model','model_provider','model_reasoning_effort','profile'}:
                try: overrides[name]=tomllib.loads('value='+raw)['value']
                except tomllib.TOMLDecodeError: overrides[name]=raw
    elif not arg.startswith('-'):
        if command is None and arg in commands: command=arg
        else:
            if command in {'exec','e'} and not positional and arg=='resume':resume_index=i
            positional.append(arg)
    i+=1
profile=profile or overrides.get('profile')
if profile:
    separate=home/(profile+'.config.toml')
    if separate.is_file(): cfg.update(tomllib.loads(separate.read_text()))
    else: cfg.update(cfg.get('profiles',{}).get(profile,{}))
cfg.update(overrides)
saved={}
if resume_index is not None:
    requested=positional[1] if len(positional)>1 and '--last' not in args else None
    for database in sorted(home.glob('state_*.sqlite'),key=lambda p:p.stat().st_mtime,reverse=True):
        try:
            db=sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
            cols={row[1] for row in db.execute('PRAGMA table_info(threads)')}
            if not {'id','model','reasoning_effort','model_provider'}.issubset(cols):db.close();continue
            fields='id, model, reasoning_effort, model_provider'
            if requested:
                row=db.execute('SELECT '+fields+' FROM threads WHERE id=?'+(' OR name=?' if 'name' in cols else '')+' LIMIT 1',([requested,requested] if 'name' in cols else [requested])).fetchone()
            elif '--last' in args:
                where='WHERE has_user_event=1' if 'has_user_event' in cols else 'WHERE 1=1'
                parameters=[]
                if '--all' not in args and 'cwd' in cols:where+=' AND cwd=?';parameters=[cwd]
                order='updated_at_ms' if 'updated_at_ms' in cols else 'updated_at'
                row=db.execute('SELECT '+fields+' FROM threads '+where+' ORDER BY '+order+' DESC LIMIT 1',parameters).fetchone()
            else:row=None
            db.close()
            if row:
                saved={'savedModel':row['model'],'savedEffort':row['reasoning_effort'],'savedProvider':row['model_provider'],'resumeThread':row['id']};break
        except (sqlite3.DatabaseError,OSError):continue
    # Older / failed resumes may have overwritten the current metadata with a
    # virtual alias. Recover only model receipts; never inspect rollout history.
    if saved.get('savedModel') in {'jev-auto','gpt-jev-auto','gpt-jev-luna','gpt-jev-sol'}:
        identity=hashlib.sha1(saved['resumeThread'].encode()).hexdigest()[:12]
        keys={hashlib.sha256(('codex:'+identity+suffix).encode()).hexdigest()[:16] for suffix in ['',':luna',':sol']}
        state=pathlib.Path(os.environ.get('JEV_SERVICE_HOME') or pathlib.Path.home()/'.config/jev-router')
        for receiptfile in [state/'decisions.jsonl.1',state/'decisions.jsonl']:
            try:
                if receiptfile.stat().st_size>10*1024*1024:continue
                for line in receiptfile.read_text().splitlines():
                    try:r=json.loads(line)
                    except ValueError:continue
                    model=r.get('served_model') if r.get('state')=='served' else r.get('model') if r.get('state')=='native-first-request' else None
                    if r.get('conversation_id') in keys and isinstance(model,str) and 'jev' not in model:
                        saved.update(savedModel=model,savedEffort=r.get('effort'))
            except OSError:continue
print(json.dumps({'model':cfg.get('model','gpt-6.1-sol'),'provider':cfg.get('model_provider','openai'),
                  'effort':cfg.get('model_reasoning_effort'),'command':command,'positional':positional,
                  'explicitEffort':'model_reasoning_effort' in overrides,
                  'explicitModel':'model' in overrides,
                  'isResume':resume_index is not None,'resumeIndex':resume_index,
                  'customHome':str(home)!=str(pathlib.Path.home()/'.codex'),**saved}))
