#!/usr/bin/env python3
"""macOS installer; refuses collisions and modifies only selected clients."""
import argparse, json, pathlib, shutil, subprocess, sys, os, importlib.util

def main():
    if sys.platform != 'darwin':
        raise SystemExit('The startup installer supports macOS only; nothing changed.')
    if sys.version_info < (3,11):
        raise SystemExit('Python 3.11 or newer required; nothing changed.')
    parser=argparse.ArgumentParser()
    parser.add_argument('--hermes',action='store_true',help='Also merge existing Hermes configuration')
    parser.add_argument('--claude',action='store_true',help='Also enable experimental Claude integration')
    args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parent.parent
    h=pathlib.Path.home();dest=h/'.local/share/jev-router';state=h/'.config/jev-router'
    node=shutil.which('node')
    if not node or not (root/'upstream/node_modules/@typesafe-ai/sdk').exists():
        raise SystemExit('Run npm ci --ignore-scripts and npm run bootstrap first.')
    if dest.exists() or state.exists():
        raise SystemExit('Existing installation or private state preserved. See docs/OPERATIONS.md for migration.')
    names=['jev-router','jev-codex','jev-claude','jev-hermes']
    if any((h/'.local/bin'/n).exists() for n in names):
        raise SystemExit('Existing command preserved; resolve the collision before installation.')
    if not (h/'.codex/config.toml').exists() or not (h/'.codex/models_cache.json').exists():
        raise SystemExit('Open Codex Desktop, sign in and load its models first; nothing changed.')
    cache=json.loads((h/'.codex/models_cache.json').read_text())
    ids={m['slug'] for m in cache.get('models',[])}
    if not {'gpt-6-luna','gpt-6.1-sol'}.issubset(ids):
        raise SystemExit('Default model IDs are absent from the client catalog. Adjust the example mapping and Desktop template first.')
    if args.hermes and not (h/'.hermes/config.yaml').exists():
        raise SystemExit('Set up Hermes normally first; nothing changed.')
    if args.claude and not (h/'.claude/settings.json').exists():
        raise SystemExit('Set up Claude Code normally first; nothing changed.')
    spec=importlib.util.spec_from_file_location('installer_manage',root/'manage.py')
    manager=importlib.util.module_from_spec(spec);spec.loader.exec_module(manager)
    if args.hermes:manager.hermes_provider((h/'.hermes/config.yaml').read_text())
    plist=h/'Library/LaunchAgents/ai.typesafe.jev-router.local.plist'
    if plist.exists():raise SystemExit('Existing LaunchAgent preserved; nothing changed.')
    subprocess.run([sys.executable,'-m','compileall','-q',str(root/'manage.py'),str(root/'desktop.py')],check=True)
    dest.parent.mkdir(parents=True,exist_ok=True)
    # Only release files; include the private upstream checkout and dependencies
    # because runtime imports upstream directly. Nothing is taken from client state.
    try:
        dest.mkdir()
        for name in ['src','ui','scripts','test','docs','upstream','node_modules']:
            shutil.copytree(root/name,dest/name,ignore=shutil.ignore_patterns('__pycache__'))
        for name in ['cli.mjs','desktop.py','manage.py','desktop-hook.mjs','config.example.json','package.json','package-lock.json','upstream.lock.json','README.md','LICENSE','NOTICE','SECURITY.md','CHANGELOG.md']:
            shutil.copy2(root/name,dest/name)
        state.mkdir(parents=True,mode=0o700)
        c=json.loads((dest/'config.example.json').read_text())
        c['clients'].update(hermes=args.hermes,claude=args.claude)
        p=state/'config.json';p.write_text(json.dumps(c,indent=2)+'\n');p.chmod(0o600)
        for name,action in [('jev-router',''),('jev-codex','codex'),('jev-claude','claude'),('jev-hermes','hermes')]:
            p=h/'.local/bin'/name;p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text('#!/bin/sh\nexport JEV_PYTHON='+shlex_quote(sys.executable)+'\nexec '+shlex_quote(node)+' '+shlex_quote(str(dest/'cli.mjs'))+' '+action+' "$@"\n');p.chmod(0o755)
        subprocess.run([sys.executable,str(dest/'manage.py'),'install-service'],check=True)
        subprocess.run([node,str(dest/'cli.mjs'),'enable'],check=True,env={**os.environ,'JEV_PYTHON':sys.executable})
    except Exception:
        # Restoration journals are written before client mutations. Keep the
        # installation/backups if recovery fails rather than deleting evidence.
        restored=subprocess.run([sys.executable,str(dest/'manage.py'),'disable'],capture_output=True) if (dest/'manage.py').exists() else None
        pending=any(p.exists() and json.loads(p.read_text()).get('active') for p in [state/'desktop-picker.json',state/'integration.json'])
        if (restored is not None and restored.returncode!=0) or pending:
            raise RuntimeError('Install failed; restoration incomplete. Private journals retained; run jev-router disable.')
        subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/ai.typesafe.jev-router.local'],capture_output=True)
        plist.unlink(missing_ok=True)
        for name in names:
            shim=h/'.local/bin'/name
            if shim.exists() and str(dest) in shim.read_text():shim.unlink()
        shutil.rmtree(dest,ignore_errors=True)
        # Retain timestamped state backups for recovery; no credentials created.
        if state.exists():
            recovery=state.with_name('jev-router-failed-'+__import__('datetime').datetime.now().strftime('%Y%m%dT%H%M%S%f'))
            state.rename(recovery)
        raise RuntimeError('Install failed; clients restored and partial installation removed. Recovery backups retained.')
    print('Installed. Restart enabled clients, select Jev, and enter the classifier key privately: jev-router key --openrouter')

def shlex_quote(value):
    import shlex
    return shlex.quote(value)

if __name__=='__main__':
    main()
