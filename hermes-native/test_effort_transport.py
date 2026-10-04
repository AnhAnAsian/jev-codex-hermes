"""Run inside the isolated Hermes tree, with its real transport and CLI handler."""
from types import SimpleNamespace
import sys

from agent.chat_completion_helpers import _build_codex_kwargs
from agent.transports.codex import ResponsesApiTransport


def fixture(monkeypatch, tmp_path):
    monkeypatch.setenv('JEV_EFFORT_CACHE_HOME', str(tmp_path/'effort'))
    transport=ResponsesApiTransport()
    agent=SimpleNamespace(model='gpt-6.1-sol',provider='openai-codex',
        base_url='https://chatgpt.com/backend-api/codex',api_mode='codex_responses',
        session_id='synthetic',max_tokens=128,reasoning_config={'enabled':True,'effort':'low'},
        _primary_runtime={},_session_init_model_config={},
        _get_transport=lambda:transport,_prepare_messages_for_non_vision_model=lambda messages:messages,
        _resolved_api_call_timeout=lambda:30)
    return agent,transport


def build(agent, messages, overrides=None):
    return _build_codex_kwargs(agent,messages,[],agent.reasoning_config,overrides or {},agent.session_id)


def test_native_builder_preflight_and_resume_replay(monkeypatch,tmp_path):
    agent,transport=fixture(monkeypatch,tmp_path)
    messages=[{'role':'system','content':'Stable prefix'},{'role':'user','content':'First'}]
    first=transport.preflight_kwargs(build(agent,messages))
    messages.extend([{'role':'assistant','content':'OK'},{'role':'user','content':'Second'}])
    agent.reasoning_config={'enabled':True,'effort':'high'}
    second=transport.preflight_kwargs(build(agent,messages))
    assert second['reasoning']==first['reasoning']
    assert second['input'][0]==first['input'][0]
    assert second['input'][-2]=={'type':'configuration_update','reasoning':{'effort':'high'}}
    cold=SimpleNamespace(**vars(agent))
    assert transport.preflight_kwargs(build(cold,messages))==second


def test_actual_reasoning_command_keeps_live_native_agent(monkeypatch,tmp_path):
    from hermes_cli.cli_commands_mixin import CLICommandsMixin
    import hermes_cli.cli_commands_mixin as commands
    agent,transport=fixture(monkeypatch,tmp_path)
    cli=SimpleNamespace(agent=agent,model='gpt-jev-auto',provider='openai-codex',reasoning_config=agent.reasoning_config)
    monkeypatch.setitem(sys.modules,'cli',SimpleNamespace(CLI_CONFIG={},_ACCENT='',_RST='',
        _parse_reasoning_config=lambda level:{'enabled':True,'effort':level}))
    monkeypatch.setattr(commands,'_cp',lambda *args:None)
    monkeypatch.setattr(commands,'_retire_agent',lambda *args:(_ for _ in ()).throw(AssertionError('Native agent retired')))
    CLICommandsMixin._handle_reasoning_command(cli,'/reasoning high')
    assert cli.agent is agent and cli.model=='gpt-6.1-sol'
    assert agent.reasoning_config['effort']=='high'
    assert agent._primary_runtime['reasoning_config']['effort']=='high'


def test_pro_and_automatic_compaction_keep_original_requests(monkeypatch,tmp_path):
    agent,transport=fixture(monkeypatch,tmp_path)
    messages=[{'role':'user','content':'First'}]
    build(agent,messages)
    messages.extend([{'role':'assistant','content':'OK'},{'role':'user','content':'Second'}])
    agent.reasoning_config={'enabled':True,'effort':'high'}
    for overrides in [{'reasoning':{'effort':'high','mode':'pro'}},
                      {'context_management':[{'type':'compaction','compact_threshold':10000}]}]:
        kwargs=build(agent,messages,overrides)
        assert kwargs['reasoning']['effort']=='high'
        assert not any(i.get('type')=='configuration_update' for i in kwargs['input'])


def test_replaced_context_starts_clean_baseline(monkeypatch,tmp_path):
    agent,transport=fixture(monkeypatch,tmp_path)
    messages=[{'role':'user','content':'First'}]
    build(agent,messages)
    messages.extend([{'role':'assistant','content':'OK'},{'role':'user','content':'Second'}])
    agent.reasoning_config={'enabled':True,'effort':'high'}
    build(agent,messages)
    compacted=[{'role':'user','content':'Compacted summary'}]
    kwargs=transport.preflight_kwargs(build(agent,compacted))
    assert kwargs['reasoning']['effort']=='high'
    assert [i for i in kwargs['input'] if i.get('type')=='configuration_update']==[
        {'type':'configuration_update','reasoning':{'effort':'high'}}]
