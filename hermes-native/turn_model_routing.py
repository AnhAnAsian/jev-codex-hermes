"""Generic model selection before the first turn of an agent runtime.

The hook receives new human input and route metadata, never transcript or credentials.
It returns model/provider/effort; core owns credential resolution and client rebuilding.
"""
import re
from urllib.parse import urlparse


def resolve_session_model(agent, user_message, conversation_history):
    if getattr(agent, "_session_model_resolved", None) == getattr(agent, "session_id", ""):
        return
    from hermes_cli.plugins import has_hook, invoke_hook
    if not has_hook("resolve_session_model"):
        return
    results = invoke_hook(
        "resolve_session_model", session_id=getattr(agent, "session_id", "") or "",
        user_message=user_message, has_history=bool(conversation_history),
        model=agent.model, provider=agent.provider, base_url=agent.base_url,
        reasoning_config=getattr(agent, "reasoning_config", None),
        platform=getattr(agent, "platform", "") or "",
    )
    for spec in results:
        if not isinstance(spec, dict) or not isinstance(spec.get("model"), str):
            continue
        model = spec["model"]
        provider = spec.get("provider") or agent.provider
        effort = spec.get("effort")
        if not re.fullmatch(r"[A-Za-z0-9._:/\[\]-]{1,180}", model):
            continue
        if not isinstance(provider, str) or not re.fullmatch(r"[A-Za-z0-9._:@/-]{1,120}", provider):
            continue
        if effort is not None and effort not in {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
            continue
        from hermes_cli.runtime_provider import resolve_runtime_provider
        base_url = spec.get("base_url")
        if base_url is not None:
            if not isinstance(base_url, str):continue
            parsed = urlparse(base_url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                continue
        runtime = resolve_runtime_provider(requested=provider, target_model=model, explicit_base_url=base_url)
        cached_prompt = getattr(agent, "_cached_system_prompt", None)
        agent.switch_model(new_model=model, new_provider=runtime["provider"],
                           api_key=runtime.get("api_key") or "", base_url=runtime.get("base_url") or "",
                           api_mode=runtime.get("api_mode") or "")
        # Resume keeps the existing prefix. New chats build it after this selection.
        if conversation_history and cached_prompt is not None:
            agent._cached_system_prompt = cached_prompt
        if effort is not None:
            agent.reasoning_config = {"enabled": effort != "none", "effort": effort}
            if getattr(agent, "_primary_runtime", None) is not None:
                agent._primary_runtime["reasoning_config"] = dict(agent.reasoning_config)
            if getattr(agent, "_session_init_model_config", None) is not None:
                agent._session_init_model_config["reasoning_config"] = dict(agent.reasoning_config)
        agent._session_model_resolved = getattr(agent, "session_id", "")
        agent._emit_status(f"Selected model: {agent.model} · reasoning: {effort or 'default'}")
        return
    agent._session_model_resolved = getattr(agent, "session_id", "")
