import importlib.util, json, pathlib, plistlib, sys, tempfile, unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('native_desktop_tested', ROOT / 'native_desktop.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)

class NativeDesktopTests(unittest.TestCase):
    def fixture(self, home):
        state = home / '.config/jev-router'; state.mkdir(parents=True)
        config = json.loads((ROOT / 'config.example.json').read_text()); config['desktop']['mode'] = 'proxy-picker'
        config['extension'] = {'preserve': True}; (state / 'config.json').write_text(json.dumps(config))
        codex = home / '.codex'; codex.mkdir()
        (codex / 'models_cache.json').write_text(json.dumps({'models': [{'slug': 'gpt-6.1-sol', 'context_window': 272000}, {'slug': 'gpt-jev-auto'}]}))
        (codex / 'config.toml').write_text('model_provider = "jev"\nmodel = "gpt-6.1-sol"\n')
        fake = home / 'native-codex'; fake.write_text('synthetic executable')
        return state, fake, config

    def patched(self, home, state):
        return patch.multiple(native, H=home, ROOT=ROOT, STATE=state, RECORD=state / 'native-desktop.json',
                              SHIM=home / '.local/bin/jev-native-codex', REAL_CATALOG=state / 'native-real-models.json',
                              PLIST=home / 'Library/LaunchAgents' / (native.LABEL + '.plist'))

    def test_install_restore_preserves_config_and_filters_virtual_models_from_native_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp); state, fake, config = self.fixture(home)
            with self.patched(home, state):
                original = (home / '.codex/config.toml').read_bytes()
                native.enable(cli=fake, register=False)
                self.assertEqual((home / '.codex/config.toml').read_bytes(), original)
                self.assertEqual(json.loads((state / 'config.json').read_text())['desktop']['mode'], 'native-first')
                catalog = json.loads(native.REAL_CATALOG.read_text()); self.assertEqual([m['slug'] for m in catalog['models']], ['gpt-6.1-sol'])
                plist = plistlib.loads(native.PLIST.read_bytes()); self.assertTrue(plist['RunAtLoad'])
                self.assertEqual(plist['ProgramArguments'], ['/bin/launchctl', 'setenv', 'CODEX_CLI_PATH', str(native.SHIM)])
                self.assertEqual(native.SHIM.stat().st_mode & 0o777, 0o755)
                self.assertTrue(pathlib.Path(json.loads(native.RECORD.read_text())['backup']).exists())
                # Unrelated changes made after installation survive restoration.
                current = json.loads((state / 'config.json').read_text()); current['extension']['later'] = True
                (state / 'config.json').write_text(json.dumps(current)); native.disable(register=False)
                restored = json.loads((state / 'config.json').read_text())
                self.assertEqual(restored['desktop'], config['desktop']); self.assertTrue(restored['extension']['later'])
                self.assertFalse(native.PLIST.exists()); self.assertFalse(json.loads(native.RECORD.read_text())['active'])

    def test_an_existing_cli_override_is_preserved_without_any_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp); state, fake, _ = self.fixture(home)
            with self.patched(home, state), patch.object(native, 'environment_value', return_value='/synthetic/other-cli'):
                original = (state / 'config.json').read_bytes()
                with self.assertRaisesRegex(RuntimeError, 'existing_cli_runtime_override_preserved'): native.enable(cli=fake)
                self.assertEqual((state / 'config.json').read_bytes(), original)
                self.assertFalse(native.RECORD.exists()); self.assertFalse(native.SHIM.exists())

    def test_failure_restores_owned_mode_and_user_modified_startup_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp); state, fake, config = self.fixture(home)
            with self.patched(home, state):
                native.enable(cli=fake, register=False)
                plist = plistlib.loads(native.PLIST.read_bytes()); plist['ProgramArguments'].append('user-edit')
                native.PLIST.write_bytes(plistlib.dumps(plist)); native.disable(register=False)
                self.assertTrue(native.PLIST.exists())
                record = json.loads(native.RECORD.read_text()); self.assertTrue(record['active'])
                self.assertIn('native LaunchAgent', record['conflicts'])
