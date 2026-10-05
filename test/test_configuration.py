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

class RecoveryTests(ConfigurationTests):
    def test_hermes_rejects_unsupported_provider_before_any_writes(self):
        for provider,mode in [('openrouter',None),('ollama',None),('openai-codex','chat_completions')]:
            with tempfile.TemporaryDirectory() as temp:
                h=pathlib.Path(temp);state=self.fixture(h,hermes=True)
                p=h/'.hermes/config.yaml';p.parent.mkdir()
                original=f'model:\n  provider: "{provider}"\n'+(f'  api_mode: "{mode}"\n' if mode else '')
                p.write_text(original)
                with patch.object(manage,'H',h),patch.object(manage,'STATE',state):
                    with self.assertRaises(RuntimeError):manage.activate()
                self.assertEqual(p.read_text(),original)
                self.assertFalse((state/'backups').exists());self.assertFalse((state/'integration.json').exists());self.assertFalse((h/'.hermes/.env').exists())

    def desktop_fixture(self,h):
        state=self.fixture(h);config=h/'.codex/config.toml';config.parent.mkdir()
        original='model = "gpt-6.1-sol"\n\n[mcp_servers.example]\ncommand = "example"\n'
        config.write_text(original)
        (h/'.codex/models_cache.json').write_text(json.dumps({'models':[{'slug':'gpt-6.1-sol','context_window':400000},{'slug':'gpt-6-luna','context_window':272000}]}))
        return state,config,original

    def test_desktop_semantic_restore_and_reenable_after_formatting(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h)
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'):
                desktop.enable();text=config.read_text().replace('name = "Jev Router"','name="Jev Router" # comment').replace('wire_api = "responses"\nrequires_openai_auth = true','requires_openai_auth=true\nwire_api="responses"')
                config.write_text(text);desktop.disable()
                self.assertEqual(config.read_text(),original)
                desktop.enable();desktop.disable();self.assertEqual(config.read_text(),original)

    def test_desktop_nested_user_table_preserved_and_journal_recoverable(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h)
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'):
                desktop.enable();config.write_text(config.read_text()+'\n[model_providers.jev.custom]\nvalue = "user"\n');desktop.disable()
                record=json.loads((state/'desktop-picker.json').read_text());self.assertTrue(record['active']);self.assertIn('model_providers.jev',record['conflicts']);self.assertIn('value = "user"',config.read_text())
                with self.assertRaises(RuntimeError):desktop.enable()
                config.write_text(config.read_text().split('[model_providers.jev.custom]')[0]);desktop.disable()
                self.assertFalse(json.loads((state/'desktop-picker.json').read_text())['active'])

    def test_refresh_catalog_updates_actual_desktop_path_and_limits(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h)
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'):
                desktop.enable()
                parsed=__import__('tomllib').loads(config.read_text());target=pathlib.Path(parsed['model_catalog_json'])
                cache=json.loads((h/'.codex/models_cache.json').read_text());cache['models'][1]['context_window']=200000;(h/'.codex/models_cache.json').write_text(json.dumps(cache))
                desktop.refresh_catalog();self.assertEqual(json.loads(target.read_text())['models'][0]['context_window'],200000)

class InstallerTests(ConfigurationTests):
    def installer_fixture(self,h):
        p=h/'.codex';p.mkdir();(p/'config.toml').write_text('model="gpt-6.1-sol"\n')
        (p/'models_cache.json').write_text(json.dumps({'models':[{'slug':'gpt-6.1-sol','context_window':400000},{'slug':'gpt-6-luna','context_window':272000}]}))
        spec=importlib.util.spec_from_file_location('installer',ROOT/'scripts/install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

    def test_verified_python_propagates_to_enable_and_failure_rolls_back(self):
        for fail in [False,True]:
            with tempfile.TemporaryDirectory() as temp:
                h=pathlib.Path(temp);m=self.installer_fixture(h);calls=[];real_run=__import__('subprocess').run
                def run(args,**kwargs):
                    calls.append((args,kwargs))
                    if args[-1]=='enable':
                        self.assertEqual(kwargs['env']['JEV_PYTHON'],sys.executable)
                        if fail:
                            real_run([sys.executable,str(h/'.local/share/jev-router/desktop.py'),'enable'],check=True,env={**os.environ,'HOME':str(h),'JEV_SERVICE_HOME':str(h/'.config/jev-router')},capture_output=True)
                            self.assertIn('model_provider = "jev"',(h/'.codex/config.toml').read_text())
                            raise __import__('subprocess').CalledProcessError(1,args)
                    if args[-1]=='disable':
                        return real_run(args,env={**os.environ,'HOME':str(h),'JEV_SERVICE_HOME':str(h/'.config/jev-router')},**kwargs)
                    return __import__('subprocess').CompletedProcess(args,0)
                with patch.object(m.pathlib.Path,'home',return_value=h),patch.object(m.sys,'platform','darwin'),patch.object(m.sys,'argv',['install.py']),patch.object(m.subprocess,'run',side_effect=run),patch.object(m.shutil,'copytree',side_effect=lambda src,dst,**kw:pathlib.Path(dst).mkdir()):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError,'clients restored'):m.main()
                        self.assertFalse((h/'.local/share/jev-router').exists());self.assertFalse((h/'.local/bin/jev-router').exists());self.assertFalse((h/'.config/jev-router').exists())
                        self.assertTrue(any(args[-1]=='disable' for args,kw in calls));self.assertEqual((h/'.codex/config.toml').read_text(),'model="gpt-6.1-sol"\n')
                    else:m.main();self.assertIn('export JEV_PYTHON=',(h/'.local/bin/jev-router').read_text())

class RuntimeIntegrationTests(unittest.TestCase):
    fixture=ConfigurationTests.fixture
    desktop_fixture=RecoveryTests.desktop_fixture
    def test_runtime_checks_follow_final_writes_and_refresh_noop_is_not_a_change(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h);calls=[]
            def check(action='check',changed=False,as_json=False):
                parsed=__import__('tomllib').loads(config.read_text())
                calls.append((changed,parsed.get('model_provider'),json.loads((state/'desktop-picker.json').read_text())['active']))
                return {'state':'not-running'}
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'),patch.object(desktop,'runtime_check',side_effect=check):
                desktop.enable();desktop.enable();desktop.refresh_catalog();desktop.disable()
                cache=json.loads((h/'.codex/models_cache.json').read_text());cache['models'][0]['context_window']=300000;(h/'.codex/models_cache.json').write_text(json.dumps(cache))
                desktop.refresh_catalog()
            self.assertEqual(calls,[(True,'jev',True),(False,'jev',True),(False,'jev',True),(True,None,False),(False,None,False)])
            self.assertEqual(config.read_text(),original)

    def test_runtime_unavailable_keeps_config_and_pending_reload(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h)
            (state/'codex-runtime-reload.json').write_text(json.dumps({'identity':'previous-process'}))
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop,'RECORD',state/'desktop-picker.json'),patch.object(desktop,'CATALOG',state/'desktop-models.json'),patch.object(desktop.subprocess,'run',side_effect=OSError('private details')):
                desktop.enable()
            self.assertIn('model_provider = "jev"',config.read_text())
            self.assertEqual(json.loads((state/'codex-runtime-reload.json').read_text()),{'identity':None})
            self.assertTrue(json.loads((state/'desktop-picker.json').read_text())['active'])

    def test_helper_receives_scoped_home_and_catalog_without_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            h=pathlib.Path(temp);state,config,original=self.desktop_fixture(h)
            config.write_text('model_catalog_json = "'+str(state/'desktop-models.json')+'"\n'+original)
            (state/'desktop-models.json').write_text(json.dumps({'models':[{'slug':'gpt-jev-sol','display_name':'Jev Sol'},{'slug':'gpt-6.1-sol'},{'slug':'hidden','visibility':'hide'}]}))
            result=__import__('subprocess').CompletedProcess([],0,stdout='{"state":"ready","busy":0}')
            with patch.object(desktop,'H',h),patch.object(desktop,'STATE',state),patch.object(desktop,'CONFIG',config),patch.object(desktop.subprocess,'run',return_value=result) as run:
                self.assertEqual(desktop.runtime_check()['state'],'ready')
            options=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(options['codexHome'],str(h/'.codex'))
            self.assertEqual(options['state'],str(state))
            self.assertEqual(options['expected'],[{'id':'gpt-jev-sol','displayName':'Jev Sol'},{'id':'gpt-6.1-sol'}])
            self.assertEqual(set(options),{'action','changed','codexHome','state','expected','codex'})
