import importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('tested_native_clients',ROOT/'native_clients.py');native=importlib.util.module_from_spec(s);s.loader.exec_module(native)

class NativeClientsTests(unittest.TestCase):
    def setup_home(self,h):
        state=h/'.config/jev-router';state.mkdir(parents=True)
        (state/'config.json').write_text(json.dumps({'port':48767}))
        (state/'native-desktop.json').write_text(json.dumps({'realCli':'synthetic','realCatalog':'synthetic-catalog'}))
        cli=h/'.local/bin/codex';cli.parent.mkdir(parents=True);target=h/'original-cli';target.write_text('original');cli.symlink_to(target)
        hermes=h/'runtime';(hermes/'agent').mkdir(parents=True);(hermes/'hermes_cli').mkdir()
        (hermes/'agent/turn_context.py').write_text('def turn(agent):\n    agent._restore_primary_runtime()\n    build_prompt()\n')
        (hermes/'hermes_cli/plugins.py').write_text('VALID_HOOKS: Set[str] = {\n}\nSHELL_UNSUPPORTED_HOOKS: Set[str] = {}\n')
        return state,hermes,cli,target
    def test_install_restore_owns_only_its_files_and_restores_original_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            envfile=h/'.hermes/.env';envfile.parent.mkdir(parents=True,exist_ok=True)
            envfile.write_text('OTHER_SETTING=preserved\nHERMES_CODEX_BASE_URL=http://127.0.0.1:48767/hermes/codex\n')
            original=(hermes/'agent/turn_context.py').read_bytes()
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'))
                self.assertFalse(cli.is_symlink());self.assertIn('native-terminal.mjs',cli.read_text())
                self.assertIn('resolve_session_model(agent, user_message, conversation_history)',(hermes/'agent/turn_context.py').read_text())
                self.assertTrue((h/'.hermes/plugins/jev-first-request/plugin.yaml').is_file())
                self.assertEqual(envfile.read_text(),'OTHER_SETTING=preserved\n')
                envfile.write_text(envfile.read_text()+'AFTER_SETTING=also-preserved\n')
                native.disable();self.assertTrue(cli.is_symlink());self.assertEqual(cli.resolve(),target.resolve())
                self.assertIn('HERMES_CODEX_BASE_URL=http://127.0.0.1:48767/hermes/codex',envfile.read_text())
                self.assertIn('AFTER_SETTING=also-preserved',envfile.read_text())
                self.assertEqual((hermes/'agent/turn_context.py').read_bytes(),original)
                self.assertFalse((hermes/'agent/turn_model_routing.py').exists())
    def test_user_edited_launcher_is_preserved_and_marked_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'));cli.write_text('user edit')
                native.disable();self.assertEqual(cli.read_text(),'user edit')
                record=json.loads((state/'native-clients.json').read_text());self.assertTrue(record['active']);self.assertIn(str(cli),record['conflicts'])

    def test_env_migration_removes_only_exact_owned_endpoint_and_keeps_other_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/'.env';original='OTHER_SETTING=preserved\nHERMES_CODEX_BASE_URL="http://127.0.0.1:48767/hermes/codex" # previous route\n'
            p.write_text(original);record={};native.remove_env_endpoint(p,'http://127.0.0.1:48767/hermes/codex',record,lambda:None)
            self.assertEqual(p.read_text(),'OTHER_SETTING=preserved\n');self.assertEqual(len(record['envChanges']),1)
            p.write_text('HERMES_CODEX_BASE_URL=https://another-provider.example\n')
            self.assertEqual(native.endpoint_lines(p.read_text(),'http://127.0.0.1:48767/hermes/codex'),[])

    def effort_surfaces(self,hermes):
        helper=hermes/'agent/chat_completion_helpers.py'
        helper.write_text('def _build_codex_kwargs(agent):\n    return agent._get_transport().build_kwargs(model=agent.model,\n        context_management=context_management, text_verbosity=getattr(agent, "text_verbosity", None))\n\ndef _build_chat_completions_kwargs(agent):\n    pass\n')
        adapter=hermes/'agent/codex_responses_adapter.py'
        adapter.write_text('_PREFLIGHT_ITEM_HANDLERS: Dict[str, Callable[..., Optional[Dict[str, Any]]]] = {\n}\n')
        (hermes/'hermes_cli/cli_commands_mixin.py').write_text('def command(self, parsed):\n        _retire_agent(self)  # Force agent re-init with new reasoning config\n')
        return helper,adapter

    def test_effort_extension_install_and_restore_preserves_routing(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'))
                helper,adapter=self.effort_surfaces(hermes)
                original=[helper.read_bytes(),adapter.read_bytes()]
                native.enable_effort_updates()
                self.assertIn('return apply_effort_updates(agent, api_kwargs)',helper.read_text())
                self.assertIn('"configuration_update": preflight_update',adapter.read_text())
                self.assertIn('if not update_live_reasoning(self, parsed)',(hermes/'hermes_cli/cli_commands_mixin.py').read_text())
                self.assertTrue((hermes/'agent/effort_cache.py').exists())
                native.disable_effort_updates()
                self.assertEqual([helper.read_bytes(),adapter.read_bytes()],original)
                self.assertFalse((hermes/'agent/effort_cache.py').exists())
                self.assertTrue((hermes/'agent/turn_model_routing.py').exists())
                self.assertTrue(json.loads((state/'native-clients.json').read_text())['active'])
                native.disable()

    def test_effort_install_refuses_changed_surface_before_mutating(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'))
                helper,adapter=self.effort_surfaces(hermes)
                adapter.write_text('changed upstream surface')
                original=helper.read_bytes()
                with self.assertRaises(RuntimeError):native.enable_effort_updates()
                self.assertEqual(helper.read_bytes(),original)
                self.assertFalse((hermes/'agent/effort_cache.py').exists())
                self.assertFalse(json.loads((state/'native-clients.json').read_text()).get('effortCacheActive'))

    def test_effort_rollback_keeps_module_when_user_edited_importing_core(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'))
                helper,adapter=self.effort_surfaces(hermes);native.enable_effort_updates()
                helper.write_text(helper.read_text()+'# User edit\n')
                native.disable_effort_updates()
                self.assertTrue((hermes/'agent/effort_cache.py').exists())
                self.assertIn('apply_effort_updates',helper.read_text())
                self.assertTrue(json.loads((state/'native-clients.json').read_text())['effortCacheActive'])

    def test_fresh_native_install_includes_effort_and_full_rollback_clears_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=pathlib.Path(tmp);state,hermes,cli,target=self.setup_home(h)
            helper,adapter=self.effort_surfaces(hermes);before=helper.read_bytes()
            with patch.multiple(native,H=h,STATE=state,RECORD=state/'native-clients.json'):
                native.enable(hermes,pathlib.Path('/synthetic/python'))
                self.assertTrue(json.loads((state/'native-clients.json').read_text())['effortCacheActive'])
                self.assertTrue((hermes/'agent/effort_cache.py').exists())
                native.disable()
                self.assertEqual(helper.read_bytes(),before)
                self.assertFalse((hermes/'agent/effort_cache.py').exists())
                self.assertFalse(json.loads((state/'native-clients.json').read_text())['effortCacheActive'])
