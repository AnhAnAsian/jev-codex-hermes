"""First-message Jev selection. Model/auth/transport remain owned by Hermes."""
import hashlib
import json
import pathlib
import subprocess
import threading
from urllib.parse import urlparse

VIRTUAL = {"jev-auto", "gpt-jev-auto", "gpt-jev-luna", "gpt-jev-sol"}
_lock = threading.RLock()


def text_only(message):
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        return "\n".join(p.get("text", "") for p in message
                         if isinstance(p, dict) and p.get("type") in {"text", "input_text"})
    return ""


def register(ctx):
    def resolve(session_id, user_message, has_history, model, provider, base_url,
                reasoning_config=None, **kwargs):
        if provider != "openai-codex":
            return None
        installation = pathlib.Path(__file__).with_name("installation.json")
        installed = json.loads(installation.read_text())
        cfg = json.loads(pathlib.Path(installed["config"]).read_text())
        url = urlparse(base_url or "")
        legacy = (url.hostname in {"127.0.0.1", "localhost"} and
                  url.port == cfg["port"] and url.path.rstrip("/") == "/hermes/codex")
        if model not in VIRTUAL and not legacy:
            return None
        profile = cfg.get("variants", {}).get("codex", {}).get(model.removeprefix("gpt-jev-")) or cfg["providers"]["codex"]
        fallback = {"model": profile["fallbackModel"], "effort": profile.get("fallbackEffort")}
        key = "session:" + hashlib.sha256(session_id.encode()).hexdigest()
        with _lock:
            try:
                pins = ctx.state.get("pins", {})
            except (OSError, ValueError, RuntimeError):
                pins = {}
            if not isinstance(pins, dict):
                pins = {}
            spec = pins.get(key) if session_id else None
            if model not in VIRTUAL:
                spec = {"model": model, "effort": (reasoning_config or {}).get("effort")}
            elif not spec and not has_history:
                try:
                    result = subprocess.run([installed["node"], installed["decision"]],
                        input=json.dumps({"model": model, "prompt": text_only(user_message)[:24000],
                                          "client": "hermes", "session": session_id}),
                        capture_output=True, text=True, timeout=25, check=True)
                    spec = json.loads(result.stdout)
                    if spec.get("model") in VIRTUAL or not isinstance(spec.get("model"), str):
                        spec = fallback
                except (OSError, ValueError, subprocess.SubprocessError):
                    spec = fallback
            # A legacy resumed alias must not send old history to the classifier.
            spec = spec or fallback
            if session_id:
                pins[key] = spec
                while len(pins) > 1000:
                    pins.pop(next(iter(pins)))
                try:
                    ctx.state.set("pins", pins)
                except (OSError, ValueError, RuntimeError):
                    pass  # The live native agent still retains its selected model.
            return {"model": spec["model"], "provider": "openai-codex", "effort": spec.get("effort"),
                    "base_url": cfg["providers"]["codex"]["upstream"]}
    ctx.register_hook("resolve_session_model", resolve)
