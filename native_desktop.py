"""Opt-in first-request routing through Desktop's existing CLI runtime override."""
import datetime, json, os, pathlib, plistlib, re, shlex, shutil, subprocess, sys
from manage import H, ROOT, STATE, read_json, write

LABEL = 'ai.typesafe.jev-router.native-desktop'
RECORD = STATE / 'native-desktop.json'
PLIST = H / 'Library/LaunchAgents' / (LABEL + '.plist')
SHIM = H / '.local/bin/jev-native-codex'
REAL_CATALOG = STATE / 'native-real-models.json'

def native_cli():
    for directory in [pathlib.Path('/Applications'), H / 'Applications']:
        if not directory.exists(): continue
        for app in directory.glob('*.app'):
            info = app / 'Contents/Info.plist'
            try:
                if plistlib.loads(info.read_bytes()).get('CFBundleIdentifier') != 'com.openai.codex': continue
            except (OSError, ValueError): continue
            cli = app / 'Contents/Resources/codex-cli/bin/codex'
            if cli.is_file(): return cli
    raise RuntimeError('desktop_native_runtime_not_found')

def environment_value():
    result = subprocess.run(['launchctl', 'getenv', 'CODEX_CLI_PATH'], capture_output=True, text=True)
    return result.stdout.strip()

def refresh_catalog():
    models = read_json(H / '.codex/models_cache.json').get('models', [])
    real = [m for m in models if isinstance(m, dict) and isinstance(m.get('slug'), str)
            and 'jev' not in m['slug']]
    if not real or not any(m['slug'] == 'gpt-6.1-sol' for m in real):
        raise RuntimeError('native_model_catalog_unavailable')
    write(REAL_CATALOG, json.dumps({'models': real}, indent=2) + '\n')

def enable(cli=None, register=True):
    if register and sys.platform != 'darwin': raise RuntimeError('native_desktop_startup_requires_macos')
    previous = read_json(RECORD)
    if previous.get('active'):
        print('Native first-request routing already installed. Restart Desktop to use it.'); return
    if previous.get('conflicts'): raise RuntimeError('native_restore_conflicts_pending')
    real = pathlib.Path(cli) if cli else native_cli()
    node = shutil.which('node')
    if not node or not real.is_file() or not (ROOT / 'native-codex.mjs').is_file():
        raise RuntimeError('native_adapter_runtime_missing')
    override = environment_value() if register else ''
    if override and override != str(SHIM): raise RuntimeError('existing_cli_runtime_override_preserved')
    shim = '#!/bin/sh\nexec ' + shlex.quote(node) + ' ' + shlex.quote(str(ROOT / 'native-codex.mjs')) + ' "$@"\n'
    if SHIM.exists() and SHIM.read_text() != shim: raise RuntimeError('native_command_collision')
    if PLIST.exists(): raise RuntimeError('native_startup_collision')
    router = read_json(STATE / 'config.json')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup = STATE / 'backups' / ('native-first-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    for index, path in enumerate([STATE / 'config.json', RECORD, SHIM, REAL_CATALOG]):
        if path.exists():
            target = backup / (str(index) + '-' + path.name)
            shutil.copy2(path, target); target.chmod(0o600)
    record = {'active': True, 'realCli': str(real), 'realCatalog': str(REAL_CATALOG),
              'shim': str(SHIM), 'previousOverride': override,
              'previousDesktopMode': router.get('desktop', {}).get('mode'),
              'backup': str(backup), 'registered': register, 'conflicts': []}
    # Journal ownership before changing configuration or launchd.
    write(RECORD, json.dumps(record, indent=2) + '\n')
    try:
        refresh_catalog(); write(SHIM, shim); SHIM.chmod(0o755)
        plist = {'Label': LABEL, 'ProgramArguments': ['/bin/launchctl', 'setenv', 'CODEX_CLI_PATH', str(SHIM)],
                 'RunAtLoad': True}
        write(PLIST, plistlib.dumps(plist).decode()); PLIST.chmod(0o600)
        router.setdefault('desktop', {})['mode'] = 'native-first'
        write(STATE / 'config.json', json.dumps(router, indent=2) + '\n')
        if register:
            subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLIST)], check=True, capture_output=True)
            subprocess.run(['launchctl', 'setenv', 'CODEX_CLI_PATH', str(SHIM)], check=True, capture_output=True)
    except BaseException:
        disable(register=register)
        raise
    print('First-request routing installed. Restart Desktop; inference then uses native OpenAI directly. Backup: ' + str(backup))

def disable(register=True):
    record = read_json(RECORD)
    if not record.get('active'): return
    conflicts = []
    if register and record.get('registered'):
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], capture_output=True)
        current = environment_value()
        if current == record.get('shim'):
            if record.get('previousOverride'):
                subprocess.run(['launchctl', 'setenv', 'CODEX_CLI_PATH', record['previousOverride']], check=True, capture_output=True)
            else:
                subprocess.run(['launchctl', 'unsetenv', 'CODEX_CLI_PATH'], check=True, capture_output=True)
        elif current != record.get('previousOverride', ''): conflicts.append('CODEX_CLI_PATH')
    if PLIST.exists():
        owned = plistlib.loads(PLIST.read_bytes())
        if owned.get('Label') == LABEL and owned.get('ProgramArguments') == ['/bin/launchctl', 'setenv', 'CODEX_CLI_PATH', record['shim']]:
            PLIST.unlink()
        else: conflicts.append('native LaunchAgent')
    router = read_json(STATE / 'config.json')
    if router.get('desktop', {}).get('mode') == 'native-first':
        if record.get('previousDesktopMode') is None: router['desktop'].pop('mode', None)
        else: router['desktop']['mode'] = record['previousDesktopMode']
        write(STATE / 'config.json', json.dumps(router, indent=2) + '\n')
    record.update(active=bool(conflicts), conflicts=conflicts)
    write(RECORD, json.dumps(record, indent=2) + '\n')
    print('Native runtime override restored. Restart Desktop to apply the previous mode.')
    if conflicts: print('User changes preserved: ' + ', '.join(conflicts))

if __name__ == '__main__':
    try:
        if sys.argv[1] == 'enable': enable()
        elif sys.argv[1] == 'disable': disable()
        elif sys.argv[1] == 'refresh': refresh_catalog()
        else: raise RuntimeError('unknown_native_action')
    except Exception as error:
        print('Native Desktop action failed: ' + type(error).__name__ + '. Backups retained.', file=sys.stderr)
        sys.exit(1)
