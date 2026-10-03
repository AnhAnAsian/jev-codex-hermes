import json,pathlib,tempfile,unittest
from unittest.mock import patch
import manage,hermes_picker
ROOT=pathlib.Path(__file__).resolve().parent.parent
class HermesPickerTests(unittest.TestCase):
 def fixture(self,h,suffix=''):
  state=h/'.config/jev-router';state.mkdir(parents=True);c=json.loads((ROOT/'config.example.json').read_text());c['clients']['hermes']=True;(state/'config.json').write_text(json.dumps(c));(state/'integration.json').write_text(json.dumps({'active':True,'changes':[]}));p=h/'.hermes/config.yaml';p.parent.mkdir();p.write_text('model:\n  provider: "openai-codex"\n  base_url: "http://127.0.0.1:48767/hermes/codex"\n'+suffix+'tools:\n  allow: true\n');return state,p
 def test_merge_restore_mapping_list_and_empty_provider_shapes(self):
  for suffix in ['', 'providers: {}\n', 'providers:\n  openai-codex:\n    models:\n      real-model: {context_window: 123}\n', 'providers:\n  openai-codex:\n    models:\n      - real-model\n']:
   with tempfile.TemporaryDirectory() as temp:
    h=pathlib.Path(temp);state,p=self.fixture(h,suffix);original=p.read_text()
    with patch.object(manage,'H',h),patch.object(manage,'STATE',state):hermes_picker.enable();hermes_picker.enable()
    journal=json.loads((state/'integration.json').read_text());self.assertEqual(len(journal['changes']),1);self.assertIn('gpt-jev-luna',p.read_text());self.assertIn('gpt-jev-sol',p.read_text());restored,conflicts=hermes_picker.restore(p.read_text(),journal['changes'][0]);self.assertEqual(conflicts,[]);self.assertEqual(restored,original)
 def test_restore_preserves_user_modified_model_metadata(self):
  with tempfile.TemporaryDirectory() as temp:
   h=pathlib.Path(temp);state,p=self.fixture(h)
   with patch.object(manage,'H',h),patch.object(manage,'STATE',state):hermes_picker.enable()
   record=json.loads((state/'integration.json').read_text())['changes'][0];text=p.read_text().replace('"gpt-jev-sol": {}','"gpt-jev-sol": {context_window: 999}');restored,conflicts=hermes_picker.restore(text,record);self.assertTrue(conflicts);self.assertIn('context_window: 999',restored);self.assertNotIn('gpt-jev-luna',restored)
 def test_unsupported_flow_shape_fails_without_writes(self):
  with tempfile.TemporaryDirectory() as temp:
   h=pathlib.Path(temp);state,p=self.fixture(h,'providers:\n  openai-codex:\n    models: [real-model]\n');original=p.read_text()
   with patch.object(manage,'H',h),patch.object(manage,'STATE',state):
    with self.assertRaises(RuntimeError):hermes_picker.enable()
   self.assertEqual(p.read_text(),original);self.assertFalse((state/'backups').exists())
