#!/usr/bin/env python3
"""Credential-free fresh-public-checkout gate; never installs a live service."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time

REPOSITORY = 'https://github.com/AnhAnAsian/jev-codex-hermes.git'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='main', help='Public branch or tag to clone')
    parser.add_argument('--report', type=Path, help='Optional metadata-only JSON report; must not already exist')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}', args.ref):
        parser.error('Use a branch or tag name beginning with a letter or digit.')
    if args.report and args.report.exists():
        parser.error('Report path already exists; choose a new filename.')
    if sys.version_info < (3, 11) or not shutil.which('git') or not shutil.which('npm'):
        parser.error('Python 3.11+, Git and Node/npm 22+ are required.')
    report = {'repository': REPOSITORY, 'ref': args.ref, 'os': platform.system(),
              'os_release': platform.release(), 'python': platform.python_version(),
              'checks': [], 'live_login': 'NOT RUN', 'native_picker': 'NOT RUN',
              'live_routing_receipts': 'NOT RUN', 'login_startup': 'NOT RUN'}
    # No classifier/provider calls. Do not pass credential environment variables
    # to cloned-source tests, and disable Git prompts/helpers and npm user config.
    env = {k: v for k, v in os.environ.items()
           if not re.search(r'KEY|TOKEN|SECRET|PASSWORD', k, re.I)
           and not k.startswith('JEV_') and not k.startswith('npm_config_')}
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1',
               GIT_CONFIG_GLOBAL=os.devnull, npm_config_userconfig=os.devnull)
    env['PATH'] = str(Path(sys.executable).parent) + os.pathsep + env.get('PATH', '')
    success = True
    with tempfile.TemporaryDirectory(prefix='jev-public-check-') as temp:
        checkout = Path(temp) / 'checkout'
        env['npm_config_cache'] = str(Path(temp) / 'npm-cache')

        def step(name, command, cwd=None):
            print(f'{name} …', flush=True)
            started = time.monotonic()
            try:
                result = subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                                        timeout=300, check=False)
                ok = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                result = None
                ok = False
            report['checks'].append({'check': name, 'ok': ok,
                                     'seconds': round(time.monotonic() - started, 1)})
            print(f'{name}: {"PASS" if ok else "FAIL"}', flush=True)
            # Do not emit arbitrary checkout output or write raw request dumps.
            if not ok:
                raise RuntimeError(name)
            return result.stdout.decode().strip()

        try:
            version = step('Node prerequisite', ['node', '--version'])
            if not re.fullmatch(r'v\d+\.\d+\.\d+', version) or int(version.split('.')[0][1:]) < 22:
                raise RuntimeError('Node 22+ required')
            report['node'] = version
            step('Anonymous public clone', ['git', '-c', 'credential.helper=',
                 'clone', '--depth', '1', '--single-branch', '--no-tags',
                 '--branch', args.ref, REPOSITORY, str(checkout)])
            report['commit'] = step('Checkout revision', ['git', 'rev-parse', 'HEAD'], checkout)
            step('Locked adapter dependencies', ['npm', 'ci', '--ignore-scripts'], checkout)
            step('Pinned upstream bootstrap', ['npm', 'run', 'bootstrap'], checkout)
            step('Adapter/config/package gate', ['npm', 'run', 'validate'], checkout)
            step('Unchanged upstream tests', ['npm', 'test', '--prefix', 'upstream'], checkout)
        except RuntimeError as error:
            success = False
            print(f'Stopped at: {error}. No live service was installed.', file=sys.stderr)
    report['ok'] = success
    if args.report:
        # Exclusive creation protects existing files; report contains no raw logs.
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
    print('Live login, native picker, provider receipts and reboot startup still require docs/CLEAN-INSTALL.md.')
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
