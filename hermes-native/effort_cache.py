"""Cache-preserving OpenAI effort updates for the existing Hermes Responses loop.

The private journal contains only settings, item offsets and SHA-256 fingerprints.
No prompts, tool results, encrypted reasoning, endpoints or credentials are stored.
History stays owned by Hermes; updates are added only to the outbound wire input.
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlparse

MODELS = frozenset({'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'})
EFFORTS = frozenset({'none', 'low', 'medium', 'high', 'xhigh', 'max'})
MAX_EVENTS = 256
MAX_JOURNAL_BYTES = 128 * 1024


def preflight_update(item, idx, _ctx):
    reasoning = item.get('reasoning')
    if (item.get('type') != 'configuration_update' or not isinstance(reasoning, dict)
            or set(reasoning) != {'effort'} or not isinstance(reasoning['effort'], str)
            or reasoning['effort'] not in EFFORTS):
        raise ValueError(f'Invalid trusted effort update at input[{idx}]')
    return {'type': 'configuration_update', 'reasoning': {'effort': reasoning['effort']}}


def update_live_reasoning(cli, configuration):
    """Keep the selected native agent and its tool/memory state on /reasoning."""
    agent = getattr(cli, 'agent', None)
    if agent is None or not isinstance(configuration, dict):
        return False
    probe = {'model': getattr(agent, 'model', None), 'input': [{'role': 'user'}],
             'reasoning': {'effort': configuration.get('effort') or 'low'}}
    try:
        if not _eligible(agent, probe):
            return False
    except (TypeError, ValueError):
        return False
    agent.reasoning_config = dict(configuration)
    for name in ('_primary_runtime', '_session_init_model_config'):
        snapshot = getattr(agent, name, None)
        if isinstance(snapshot, dict):
            snapshot['reasoning_config'] = dict(configuration)
    # A Jev alias was only the first-task selection. Rebuilding after a later
    # command must use the real selected model, not resurrect the alias's pin.
    if getattr(cli, 'model', None) in {'jev-auto', 'gpt-jev-auto', 'gpt-jev-luna', 'gpt-jev-sol'}:
        cli.model = agent.model
    # Hermes normally records effort at agent construction. An in-place change
    # must update that one metadata field so a process restart restores it too.
    database = getattr(agent, '_session_db', None)
    merge = getattr(database, '_write_model_config_patch', None)
    if callable(merge):
        try:
            merge(agent.session_id, {'reasoning_config': dict(configuration)})
        except Exception:
            pass  # An unavailable session DB must not prevent a live effort swap.
    return True


def _digest(value):
    digest = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(',', ':'), ensure_ascii=True).iterencode(value):
        # Avoid an additional whole-image byte allocation during fingerprinting.
        for offset in range(0, len(chunk), 65536):
            digest.update(chunk[offset:offset + 65536].encode())
    return digest.hexdigest()


def _eligible(agent, kwargs):
    url = urlparse(getattr(agent, 'base_url', '') or '')
    official = (url.scheme == 'https' and not url.username and not url.password
                and not url.query and not url.fragment and url.port in {None, 443}
                and ((url.hostname == 'api.openai.com' and url.path.rstrip('/') == '/v1')
                     or (url.hostname == 'chatgpt.com' and url.path.rstrip('/') == '/backend-api/codex')))
    reasoning = kwargs.get('reasoning')
    extra = kwargs.get('extra_body') or {}
    if not isinstance(extra, dict) or not isinstance(reasoning, dict):
        return False
    # These modes cannot be combined with configuration_update. Preserve the
    # existing provider path, including native automatic-compaction directives.
    incompatible = ('context_management', 'previous_response_id', 'conversation',
                    'agents', 'agent', 'multi_agent', 'moa')
    return (official and getattr(agent, 'api_mode', None) == 'codex_responses'
            and getattr(agent, 'provider', None) in {'openai', 'openai-codex'}
            and not getattr(agent, '_turn_origin', None)
            and kwargs.get('model') in MODELS
            and reasoning.get('effort') in EFFORTS
            and reasoning.get('mode', 'standard') == 'standard'
            and not any(k in extra for k in ('reasoning', 'input', 'model'))
            and not any(kwargs.get(k) or extra.get(k) for k in incompatible)
            and kwargs.get('truncation', 'disabled') in {None, 'disabled'}
            and extra.get('truncation', 'disabled') in {None, 'disabled'}
            and bool(getattr(agent, 'session_id', None))
            and isinstance(kwargs.get('input'), list) and bool(kwargs['input'])
            and all(isinstance(item, dict) and item.get('type') != 'configuration_update'
                    for item in kwargs['input']))


def _valid(state, scope):
    if not isinstance(state, dict) or state.get('version') != 1 or state.get('scope') != scope:
        return False
    events = state.get('events')
    count = state.get('count')
    if (state.get('baseline') not in EFFORTS or state.get('effort') not in EFFORTS
            or type(count) is not int or count < 0
            or not isinstance(state.get('prefix'), str)
            or not isinstance(events, list) or len(events) > MAX_EVENTS):
        return False
    position = -1
    for event in events:
        if (not isinstance(event, dict) or type(event.get('at')) is not int
                or not position <= event['at'] <= count or event.get('effort') not in EFFORTS):
            return False
        position = event['at']
    return True


def _read(path):
    if not path.exists():
        return None
    if path.is_symlink() or path.stat().st_size > MAX_JOURNAL_BYTES:
        raise ValueError('Invalid effort journal')
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeError):
        return None


def _write(path, state):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.effort-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply_effort_updates(agent, kwargs, *, state_dir=None):
    """Pin request effort and replay trusted updates on append-only history.

    Rewrites/removal (including successful local compaction) start a new baseline.
    A failed compaction that retains history keeps the old baseline. Retries replay
    the same update; fork turns never touch their parent's journal. Any state I/O
    failure returns the ordinary request rather than preventing inference.
    """
    try:
        if not _eligible(agent, kwargs):
            return kwargs
        if state_dir is None:
            from hermes_constants import get_hermes_home
            state_dir = Path(os.environ.get('JEV_EFFORT_CACHE_HOME') or get_hermes_home() / 'cache/jev-effort')
        directory = Path(state_dir)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if directory.is_symlink():
            return kwargs
        path = directory / (_digest(str(agent.session_id)) + '.json')
        items = kwargs['input']
        effort = kwargs['reasoning']['effort']  # already clamped by Hermes' transport
        reasoning = {k: v for k, v in kwargs['reasoning'].items() if k != 'effort'}
        scope = _digest([kwargs['model'], agent.provider, agent.base_url,
                         kwargs.get('instructions'), kwargs.get('tools'), reasoning,
                         kwargs.get('text'), kwargs.get('service_tier')])
        # Short local lock only: no network calls or inference while held.
        import fcntl
        lock = directory / (path.stem + '.lock')
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(fd, 'a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            state = _read(path)
            known = isinstance(state, dict) and _valid(state, state.get('scope'))
            continuous = (_valid(state, scope) and len(items) >= state['count']
                          and _digest(items[:state['count']]) == state['prefix'])
            if not continuous:
                # A replacement context needs a fresh update, even when effort
                # is unchanged. Establish the new context's effort-update prefix
                # before warming it; don't wait for the first later effort swap.
                user = next((i for i in range(len(items) - 1, -1, -1)
                             if items[i].get('role') == 'user'), len(items))
                state = {'version': 1, 'scope': scope, 'baseline': effort, 'effort': effort,
                         'events': [{'at': user, 'effort': effort}] if known else [], 'count': 0}
            if effort != state['effort']:
                # Insert before a new user turn. During an in-turn tool continuation,
                # append after existing items so an earlier prefix is never rewritten.
                user = next((i for i in range(len(items) - 1, -1, -1)
                             if items[i].get('role') == 'user'), len(items))
                position = user if user >= state['count'] else len(items)
                state['events'].append({'at': position, 'effort': effort})
                state['effort'] = effort
            if len(state['events']) > MAX_EVENTS:
                # Bound journal growth; a fresh prefix is safe and applies the
                # requested effort, though this exceptional reset can lose reuse.
                state.update(baseline=effort, effort=effort, events=[])
            state.update(count=len(items), prefix=_digest(items))
            _write(path, state)
        updated = []
        position = 0
        for event in state['events']:
            updated.extend(items[position:event['at']])
            updated.append({'type': 'configuration_update', 'reasoning': {'effort': event['effort']}})
            position = event['at']
        updated.extend(items[position:])
        return {**kwargs, 'reasoning': {**kwargs['reasoning'], 'effort': state['baseline']}, 'input': updated}
    except (OSError, ValueError, TypeError, KeyError, ImportError):
        return kwargs
