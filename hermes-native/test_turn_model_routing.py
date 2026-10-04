"""Invariants for the generic first-runtime model hook."""
from types import SimpleNamespace
from unittest.mock import patch
from agent.turn_model_routing import resolve_session_model


def agent():
    a=SimpleNamespace(model='virtual-test',provider='openai-codex',base_url='https://chatgpt.com/backend-api/codex',
        session_id='synthetic',reasoning_config={'enabled':True,'effort':'low'},_primary_runtime={},_session_init_model_config={},_cached_system_prompt='Stable prefix')
    a.status=[];a._emit_status=a.status.append;a.switches=[]
    def switch(**kw):
        a.switches.append(kw);a.model=kw['new_model'];a.provider=kw['new_provider'];a.base_url=kw['base_url'];a._cached_system_prompt=None
    a.switch_model=switch
    return a


def test_selection_happens_once_and_preserves_resumed_prefix_and_effort():
    a=agent();history=[{'role':'assistant','content':'Past message'}];captured=[]
    def invoke(*args,**kwargs):
        captured.append(kwargs);return [{'model':'gpt-6-luna','provider':'openai-codex','effort':'high'}]
    with patch('hermes_cli.plugins.has_hook',return_value=True),patch('hermes_cli.plugins.invoke_hook',side_effect=invoke),patch('hermes_cli.runtime_provider.resolve_runtime_provider',return_value={'provider':'openai-codex','base_url':a.base_url,'api_mode':'codex_responses'}):
        resolve_session_model(a,'Initial message',history);resolve_session_model(a,'Followup',history)
    assert len(a.switches)==1
    assert captured[0]['user_message']=='Initial message' and captured[0]['has_history']
    assert 'conversation_history' not in captured[0] and 'api_key' not in captured[0]
    assert a._cached_system_prompt=='Stable prefix'
    assert a._primary_runtime['reasoning_config']['effort']=='high'
    assert a._session_init_model_config['reasoning_config']['effort']=='high'
    assert history==[{'role':'assistant','content':'Past message'}]


def test_invalid_hook_results_cannot_change_runtime():
    a=agent()
    with patch('hermes_cli.plugins.has_hook',return_value=True),patch('hermes_cli.plugins.invoke_hook',return_value=[{'model':'bad\nmodel'},{'model':'gpt-6-luna','effort':'invalid'}]):
        resolve_session_model(a,'Initial message',None)
    assert a.model=='virtual-test' and not a.switches


def test_plugin_pins_are_profile_scoped_and_manual_models_skip_classification(tmp_path, monkeypatch):
    import importlib.util,json,shutil,pathlib
    from hermes_cli.plugins_state import PluginState
    # This test file is copied into the isolated Hermes tree by the adapter validation.
    plugin_source=pathlib.Path(__file__).resolve().parents[2]/'jev-plugin-fixture'
    fixture=tmp_path/'plugin';shutil.copytree(plugin_source,fixture)
    cfg=tmp_path/'router.json';cfg.write_text(json.dumps({'port':48767,'providers':{'codex':{'fallbackModel':'gpt-6.1-sol','fallbackEffort':'medium','upstream':'https://chatgpt.com/backend-api/codex'}}}))
    (fixture/'installation.json').write_text(json.dumps({'node':'unused','decision':'unused','config':str(cfg)}))
    spec=importlib.util.spec_from_file_location('routing_fixture',fixture/'__init__.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    callback={};ctx=SimpleNamespace(state=PluginState('jev-first-request'),register_hook=lambda name,fn:callback.update({name:fn}))
    module.register(ctx);calls=[]
    def decide(*args,**kw):
        calls.append(json.loads(kw['input']));return SimpleNamespace(stdout=json.dumps({'model':'gpt-6-luna','effort':'high'}))
    monkeypatch.setattr(module.subprocess,'run',decide)
    def route(home,history=False,model='gpt-jev-auto'):
        monkeypatch.setenv('HERMES_HOME',str(home))
        return callback['resolve_session_model'](session_id='same-session',user_message=[{'type':'text','text':'First human input'},{'type':'image_url','image_url':{'url':'private-image'}}],has_history=history,model=model,provider='openai-codex',base_url='https://chatgpt.com/backend-api/codex')
    a=tmp_path/'a';b=tmp_path/'b'
    first=route(a);assert first['model']=='gpt-6-luna' and len(calls)==1
    assert route(a,True)==first and len(calls)==1
    assert route(b,True)['model']=='gpt-6.1-sol' and len(calls)==1
    assert route(a,True)==first and len(calls)==1
    assert calls[0]['prompt']=='First human input' and 'history' not in calls[0]
    assert route(a,True,'gpt-6.1-sol') is None


def test_new_session_reopens_selection_and_resets_a_routed_agent_to_config_default(monkeypatch):
    import sys
    from hermes_cli.cli_session_mixin import _reset_model_to_config_default
    from unittest.mock import Mock
    a=agent();a.model='gpt-6-luna';a._session_model_resolved='previous-session'
    cli=SimpleNamespace(model='virtual-test',provider='openai-codex',base_url=a.base_url,api_key='synthetic',agent=a)
    facade=SimpleNamespace(CLI_CONFIG={'model':{'default':'virtual-test','provider':'openai-codex'}},_cprint=lambda *x:None,
        _split_model_config_default=lambda value:(value,None),logger=Mock())
    monkeypatch.setitem(sys.modules,'cli',facade)
    destination=SimpleNamespace(success=True,new_model='virtual-test',target_provider='openai-codex',api_key='synthetic',base_url=a.base_url,api_mode='codex_responses')
    monkeypatch.setattr('hermes_cli.model_switch.switch_model',lambda **kw:destination)
    _reset_model_to_config_default(cli,True)
    assert a.model=='virtual-test' and len(a.switches)==1
    a.session_id='new-session'
    with patch('hermes_cli.plugins.has_hook',return_value=True),patch('hermes_cli.plugins.invoke_hook',return_value=[{'model':'gpt-6.1-sol','effort':'high'}]) as callback,patch('hermes_cli.runtime_provider.resolve_runtime_provider',return_value={'provider':'openai-codex','base_url':a.base_url,'api_mode':'codex_responses'}):
        resolve_session_model(a,'New initial message',[])
    assert callback.call_count==1 and a.model=='gpt-6.1-sol'
