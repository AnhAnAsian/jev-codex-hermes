"""Real package copying and config restoration; no launchd or client login.

Process boundaries that would start the user's service are replaced by calls to
the copied configuration helpers. This is not live macOS/client acceptance.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class InstalledPackageTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin', 'macOS installer packaging check')
    def test_copied_runtime_catalog_startup_definition_and_restore(self):
        real_run = subprocess.run
        with tempfile.TemporaryDirectory(prefix='jev-package-') as temp:
            home = Path(temp).resolve()
            dest = home / '.local/share/jev-router'
            state = home / '.config/jev-router'
            codex = home / '.codex/config.toml'
            hermes = home / '.hermes/config.yaml'
            env_file = home / '.hermes/.env'
            codex.parent.mkdir()
            hermes.parent.mkdir()
            original_codex = 'model = "gpt-6.1-sol"\n\n[mcp_servers.example]\ncommand = "example"\n'
            original_hermes = 'model:\n  provider: "openai-codex"\n  default: "gpt-6.1-sol"\n  context_length: 272000\ntools:\n  allow: true\n'
            codex.write_text(original_codex)
            hermes.write_text(original_hermes)
            env_file.write_text('UNRELATED_SETTING=synthetic\n')
            (codex.parent / 'models_cache.json').write_text(json.dumps({'models': [
                {'slug': 'gpt-6.1-sol', 'context_window': 400000},
                {'slug': 'gpt-6-luna', 'context_window': 272000},
            ]}))
            copied = {}

            def safe_process(args, **kwargs):
                if args[1:4] == ['-m', 'compileall', '-q']:
                    return real_run(args, **kwargs)
                if args[1:] == [str(dest / 'manage.py'), 'install-service']:
                    copied['manage'] = module('installed_manage', dest / 'manage.py')
                    with patch.dict(sys.modules, {'manage': copied['manage']}):
                        copied['desktop'] = module('installed_desktop', dest / 'desktop.py')
                        copied['picker'] = module('installed_picker', dest / 'hermes_picker.py')
                    copied['manage'].service_install()  # Writes only the fixture plist.
                elif args[1:] == [str(dest / 'cli.mjs'), 'enable']:
                    self.assertEqual(kwargs['env']['JEV_PYTHON'], sys.executable)
                    with patch.dict(sys.modules, {'hermes_picker': copied['picker']}):
                        copied['manage'].activate()
                    copied['desktop'].enable()
                elif args[1:] == [str(dest / 'desktop.py'), 'disable']:
                    copied['desktop'].disable()
                else:
                    self.fail('Unexpected process boundary in isolated package test')
                return subprocess.CompletedProcess(args, 0)

            with patch.object(Path, 'home', return_value=home), \
                    patch.dict(os.environ, {'JEV_SERVICE_HOME': str(state)}), \
                    patch.object(sys, 'argv', ['install.py', '--hermes']), \
                    patch.object(subprocess, 'run', side_effect=safe_process), \
                    contextlib.redirect_stdout(io.StringIO()):
                module('package_installer', ROOT / 'scripts/install.py').main()
                self.assertTrue((dest / 'upstream/node_modules/@typesafe-ai/sdk').exists())
                self.assertTrue((dest / 'node_modules/ws').exists())
                self.assertIn('requires_openai_auth = true', codex.read_text())
                self.assertIn('[mcp_servers.example]', codex.read_text())
                self.assertIn('gpt-jev-sol', hermes.read_text())
                self.assertIn('provider: "openai-codex"', hermes.read_text())
                catalog = json.loads((state / 'desktop-models.json').read_text())
                self.assertEqual([m['slug'] for m in catalog['models'][:3]],
                                 ['gpt-jev-auto', 'gpt-jev-luna', 'gpt-jev-sol'])
                plist_path = home / 'Library/LaunchAgents/ai.typesafe.jev-router.local.plist'
                plist = plistlib.loads(plist_path.read_bytes())
                self.assertEqual(plist['ProgramArguments'][1], str(dest / 'src/service.mjs'))
                self.assertEqual(plist['EnvironmentVariables']['JEV_SERVICE_HOME'], str(state))
                self.assertTrue(plist['RunAtLoad'])
                self.assertTrue(plist['KeepAlive'])
                for path in [plist_path, state / 'config.json']:
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                # Real installed shim/runtime imports, using only synthetic state.
                result = real_run([str(home / '.local/bin/jev-router'), 'config'],
                                  env={'PATH': os.environ['PATH'], 'JEV_SERVICE_HOME': str(state)},
                                  capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, 'Copied CLI failed to load')
                self.assertEqual(result.stdout.strip(), str(state / 'config.json'))
                with patch.dict(sys.modules, {'hermes_picker': copied['picker']}):
                    copied['manage'].deactivate()
                self.assertEqual(codex.read_text(), original_codex)
                self.assertEqual(hermes.read_text(), original_hermes)
                self.assertEqual(env_file.read_text(), 'UNRELATED_SETTING=synthetic\n')
                self.assertFalse((state / 'desktop-picker.json').exists() and
                                 json.loads((state / 'desktop-picker.json').read_text())['active'])
                self.assertFalse((home / '.claude').exists())
                self.assertFalse((codex.parent / 'auth.json').exists())
