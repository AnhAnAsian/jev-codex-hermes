import importlib.util, json, os, pathlib, tempfile, unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('manage',ROOT/'manage.py')
manage=importlib.util.module_from_spec(spec);spec.loader.exec_module(manage)
import sys
sys.modules['manage']=manage
spec=importlib.util.spec_from_file_location('desktop',ROOT/'desktop.py')
desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)

class ConfigurationTests(unittest.TestCase):
    def fixture(self,home,hermes=False,claude=False):
        state=home/'.config/jev-router';state.mkdir(parents=True)
        c=json.loads((ROOT/'config.example.json').read_text())
        c['clients'].update(hermes=hermes,claude=claude)
        (state/'config.json').write_text(json.dumps(c))
        return state

    def test_codex_only_does_not_create_other_client_files_or_hook(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state=self.fixture(h)
            with patch.object(manage,'H',h),patch.object(manage,'STATE',state):
                manage.activate()
            self.assertFalse((h/'.hermes').exists())
            self.assertFalse((h/'.claude').exists())
            self.assertFalse((h/'.codex/hooks.json').exists())
            self.assertEqual(json.loads((state/'integration.json').read_text())['changes'],[])

    def test_hermes_merge_and_restore_preserves_unrelated_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state=self.fixture(h,hermes=True)
            p=h/'.hermes/config.yaml';p.parent.mkdir()
            original='model:\n  provider: "openai-codex"\n  default: "gpt-6.1-sol"\n  context_length: 272000\ntools:\n  allow: true\n'
            p.write_text(original)
            with patch.object(manage,'H',h),patch.object(manage,'STATE',state),patch.object(manage.subprocess,'run'):
                manage.activate()
                self.assertIn('provider: "openai-codex"',p.read_text())
                self.assertIn('gpt-jev-auto',p.read_text())
                self.assertNotIn('base_url:',p.read_text().split('model_aliases:')[1])
                manage.deactivate()
            self.assertEqual(p.read_text(),original)
            self.assertEqual((h/'.hermes/.env').read_text(),'')

    def test_desktop_restore_handles_saved_virtual_default(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state=self.fixture(h)
            config=h/'.codex/config.toml';config.parent.mkdir()
            original='model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n\n[mcp_servers.example]\ncommand = "example"\n'
            config.write_text(original)
            models=[{'slug':'gpt-6.1-sol','context_window':400000},{'slug':'gpt-6-luna','context_window':272000}]
            (h/'.codex/models_cache.json').write_text(json.dumps({'models':models}))
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'):
                desktop.enable()
                config.write_text(config.read_text().replace('model = "gpt-6.1-sol"','model = "gpt-jev-sol"'))
                desktop.disable()
            self.assertEqual(config.read_text(),original)

if __name__=='__main__':
    unittest.main()
