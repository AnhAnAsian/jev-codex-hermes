import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('effort_extension', ROOT/'hermes-native/effort_cache.py')
effort = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effort)


class HermesEffortTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.agent = SimpleNamespace(session_id='synthetic-session', provider='openai-codex',
                                     api_mode='codex_responses', base_url='https://chatgpt.com/backend-api/codex')

    def kwargs(self, level='low', items=None):
        return {'model': 'gpt-6.1-sol', 'instructions': 'Stable instructions',
                'reasoning': {'effort': level, 'summary': 'auto'}, 'store': False,
                'input': items or [{'role': 'user', 'content': 'Synthetic input'}],
                'tools': [{'type': 'function', 'name': 'memory', 'parameters': {}}]}

    def apply(self, kwargs, agent=None):
        return effort.apply_effort_updates(agent or self.agent, kwargs, state_dir=self.home)

    def followup(self, previous, level, text='Next input'):
        return self.kwargs(level, previous['input'] + [{'role': 'assistant', 'content': 'OK'},
                                                       {'role': 'user', 'content': text}])

    def test_effort_swap_preserves_original_prefix_and_tools(self):
        first = self.kwargs()
        a = self.apply(first)
        second = self.followup(first, 'high')
        original = copy.deepcopy(second)
        b = self.apply(second)
        self.assertEqual(a, first)
        self.assertEqual(b['reasoning'], a['reasoning'])
        self.assertEqual(b['tools'], first['tools'])
        self.assertEqual(b['input'][:2], second['input'][:2])
        self.assertEqual(b['input'][2], {'type': 'configuration_update', 'reasoning': {'effort': 'high'}})
        self.assertEqual(b['input'][3], second['input'][2])
        self.assertEqual(second, original)
        # Same-input retry must not duplicate the update.
        self.assertEqual(self.apply(second), b)
        third = self.followup(second, 'low', 'Third input')
        c = self.apply(third)
        self.assertEqual(c['input'][:len(b['input'])], b['input'])
        self.assertEqual(c['reasoning']['effort'], 'low')
        self.assertEqual([x['reasoning']['effort'] for x in c['input'] if x.get('type') == 'configuration_update'], ['high', 'low'])

    def test_cold_agent_resume_retains_baseline_and_update_order(self):
        first = self.kwargs()
        self.apply(first)
        second = self.followup(first, 'high')
        before = self.apply(second)
        cold = copy.copy(self.agent)
        self.assertEqual(self.apply(second, cold), before)
        resumed = self.followup(second, 'medium')
        after = self.apply(resumed, cold)
        self.assertEqual(after['reasoning']['effort'], 'low')
        self.assertEqual([x['reasoning']['effort'] for x in after['input'] if x.get('type') == 'configuration_update'], ['high', 'medium'])

    def test_tool_continuation_never_inserts_before_earlier_user(self):
        first = self.kwargs()
        self.apply(first)
        continuation = self.kwargs('high', first['input'] + [
            {'type': 'function_call', 'call_id': 'test', 'name': 'memory', 'arguments': '{}'},
            {'type': 'function_call_output', 'call_id': 'test', 'output': 'Result'}])
        updated = self.apply(continuation)
        self.assertEqual(updated['input'][:-1], continuation['input'])
        self.assertEqual(updated['input'][-1]['type'], 'configuration_update')

    def test_local_compaction_or_history_replacement_resets_baseline(self):
        first = self.kwargs()
        self.apply(first)
        second = self.followup(first, 'high')
        self.apply(second)
        compacted = self.kwargs('high', [{'role': 'user', 'content': 'Compacted context summary'}])
        actual = self.apply(compacted)
        self.assertEqual(actual['reasoning'], compacted['reasoning'])
        self.assertEqual(actual['input'][0], {'type': 'configuration_update', 'reasoning': {'effort': 'high'}})
        next_turn = self.followup(compacted, 'low')
        updated = self.apply(next_turn)
        self.assertEqual(updated['reasoning']['effort'], 'high')
        self.assertEqual([x['reasoning']['effort'] for x in updated['input'] if x.get('type') == 'configuration_update'], ['high','low'])

    def test_failed_compaction_with_unchanged_history_does_not_reset(self):
        first = self.kwargs()
        self.apply(first)
        second = self.followup(first, 'high')
        before = self.apply(second)
        self.assertEqual(self.apply(copy.deepcopy(second)), before)

    def test_new_session_model_provider_and_instruction_changes_are_scoped(self):
        first = self.kwargs()
        self.apply(first)
        for changed in ['session', 'model', 'provider', 'instructions', 'tools']:
            with self.subTest(changed=changed):
                a = copy.copy(self.agent)
                request = self.followup(first, 'high')
                if changed == 'session': a.session_id = 'different-session'
                if changed == 'model': request['model'] = 'gpt-6-luna'
                if changed == 'provider': a.provider = 'openai'
                if changed == 'instructions': request['instructions'] = 'Different prefix'
                if changed == 'tools': request['tools'] = []
                result=self.apply(request, a)
                self.assertEqual(result['reasoning'],request['reasoning'])
                self.assertEqual([i for i in result['input'] if i.get('type')!='configuration_update'],request['input'])
                self.apply(first)  # Restore the baseline for the next subcase.

    def test_profiles_have_separate_private_state(self):
        first = self.kwargs()
        self.apply(first)
        second = self.followup(first, 'high')
        other = effort.apply_effort_updates(self.agent, second, state_dir=self.home/'other-profile')
        self.assertEqual(other, second)
        self.assertEqual(self.apply(second)['reasoning']['effort'], 'low')

    def test_unsupported_modes_and_origins_preserve_existing_behavior(self):
        first = self.kwargs()
        self.apply(first)
        variations = [
            ('model', 'gpt-5.6'), ('model', 'gpt-6.1-sol-pro'),
            ('context_management', [{'type': 'compaction', 'compact_threshold': 10000}]),
            ('truncation', 'auto'), ('agents', [{}]), ('previous_response_id', 'synthetic'),
            ('reasoning', {'mode': 'pro', 'effort': 'high'}),
            ('extra_body', {'reasoning': {'effort': 'high'}}),
            ('extra_body', {'reasoning': {}}), ('extra_body', {'input': []}),
            ('extra_body', {'context_management': [{}]}), ('extra_body', {'truncation': 'auto'}),
        ]
        for key, value in variations:
            with self.subTest(key=key, value=value):
                request = self.followup(first, 'high');request[key] = value
                self.assertIs(self.apply(request), request)
        for base in ['http://127.0.0.1:48767/hermes/codex', 'https://evil.example/v1',
                     'https://chatgpt.com.evil.example/backend-api/codex', 'https://api.openai.com/v1/responses']:
            a = copy.copy(self.agent);a.base_url = base
            request = self.followup(first, 'high')
            self.assertIs(self.apply(request, a), request)
        a = copy.copy(self.agent);a.api_mode = 'codex_app_server'
        request = self.followup(first, 'high')
        self.assertIs(self.apply(request, a), request)

    def test_fork_turns_never_modify_parent_journal(self):
        first = self.kwargs();self.apply(first)
        a = copy.copy(self.agent);a._turn_origin = 'side_question'
        fork = self.followup(first, 'high');self.assertIs(self.apply(fork, a), fork)
        self.assertEqual(self.apply(self.followup(first, 'medium'))['reasoning']['effort'], 'low')

    def test_journal_contains_no_transcript_or_credentials(self):
        first = self.kwargs();self.apply(first)
        self.apply(self.followup(first, 'high'))
        path = next(self.home.glob('*.json'))
        text = path.read_text()
        for secret in ['Synthetic input', 'Stable instructions', 'Next input', 'chatgpt.com', 'memory']:
            self.assertNotIn(secret, text)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(set(json.loads(text)), {'version', 'scope', 'baseline', 'effort', 'events', 'count', 'prefix'})

    def test_corrupt_state_or_io_failure_does_not_abort_inference(self):
        first = self.kwargs();self.apply(first)
        next(self.home.glob('*.json')).write_text('{broken')
        second = self.followup(first, 'high')
        self.assertEqual(self.apply(second), second)
        with patch.object(effort, '_write', side_effect=OSError('Read only')):
            request = self.followup(second, 'low')
            self.assertIs(self.apply(request), request)

    def test_event_bound_uses_fresh_baseline(self):
        first = self.kwargs();self.apply(first)
        with patch.object(effort, 'MAX_EVENTS', 1):
            second = self.followup(first, 'high');self.apply(second)
            third = self.followup(second, 'medium')
            self.assertEqual(self.apply(third), third)

    def test_preflight_accepts_only_trusted_effort_shape(self):
        valid = {'type': 'configuration_update', 'id': 'unused', 'reasoning': {'effort': 'high'}}
        self.assertEqual(effort.preflight_update(valid, 0, None),
                         {'type': 'configuration_update', 'reasoning': {'effort': 'high'}})
        for reasoning in [None, {}, {'effort': 'invalid'}, {'effort': {}}, {'effort': 'high', 'mode': 'pro'}]:
            with self.assertRaises(ValueError):
                effort.preflight_update({'type': 'configuration_update', 'reasoning': reasoning}, 0, None)

    def test_live_effort_command_preserves_agent_tools_and_selected_model(self):
        self.agent.model='gpt-6.1-sol'
        self.agent.tools=['memory', 'delegate_task']
        self.agent._primary_runtime={};self.agent._session_init_model_config={}
        persisted=[]
        self.agent._session_db=SimpleNamespace(_write_model_config_patch=lambda sid,change:persisted.append((sid,change)))
        cli=SimpleNamespace(agent=self.agent, model='gpt-jev-auto')
        rc={'enabled':True,'effort':'high'}
        self.assertTrue(effort.update_live_reasoning(cli, rc))
        self.assertIs(cli.agent, self.agent)
        self.assertEqual(cli.model, 'gpt-6.1-sol')
        self.assertEqual(cli.agent.tools, ['memory', 'delegate_task'])
        self.assertEqual(cli.agent.reasoning_config, rc)
        self.assertEqual(cli.agent._primary_runtime['reasoning_config'], rc)
        self.assertEqual(cli.agent._session_init_model_config['reasoning_config'], rc)
        self.assertEqual(persisted, [('synthetic-session', {'reasoning_config': rc})])
        rc['effort']='low'
        self.assertEqual(cli.agent.reasoning_config['effort'], 'high')
        self.agent.api_mode='anthropic_messages'
        self.assertFalse(effort.update_live_reasoning(cli, rc))


if __name__ == '__main__':
    unittest.main()
