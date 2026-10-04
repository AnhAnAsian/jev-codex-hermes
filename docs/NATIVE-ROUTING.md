# Native first-request routing

[README](../README.md) · [Clients](CLIENTS.md) · [Operations](OPERATIONS.md) · [Validation](VALIDATION.md)

Jev selects a real model and reasoning effort from the initial human task text.
The native client then owns inference, conversation history, tools, permissions
and compaction. Follow-ups do not return to the Jev HTTP inference gateway or
send history to the classifier. Manual real-model selections skip classification.
External classification still uses the configured TypeSafe/OpenRouter backend.

This mode is opt-in. The normal installer initially configures the legacy proxy.
Updating a checkout alone does not update installed code or activate native mode.
Follow [adapter migration](OPERATIONS.md#existing-installation--adapter-migration)
first when upgrading an existing installation.

## Codex Desktop

After installing this adapter and configuring a classifier key:

```sh
~/.local/bin/jev-router desktop-native-enable
```

Quit and reopen Desktop. Choose Jev, Jev Luna or Jev Sol for a new chat. The adapter
adds virtual profiles to Desktop's model-list response, selects before the first
turn, and confirms the real model/effort in the picker after turn-start restoration.
The native runtime and subagent model catalog contain real models only.

The installer uses the inspected Desktop build's `CODEX_CLI_PATH` runtime override
and a user LaunchAgent to set it at login. It does not patch the app binary or
authentication store. The native app-server RPC interface is experimental;
revalidate after Desktop updates. Existing running app-server processes retain
their loaded code until Desktop restarts.

Cold resume preserves saved real model/effort even when the new-chat default is
Jev. Old proxy-provider chats migrate to OpenAI on cold resume. Metadata-only
receipts can recover legacy virtual pins; missing metadata uses a real fallback
rather than sending the old conversation to the classifier. Explicit real-model
selections take precedence.

## Hermes and terminal Codex

The current combined installer requires:

- An existing Jev installation and native Desktop catalog from the command above.
- First-party Hermes configured for `openai-codex`, with its active source root
  and the Python interpreter that can import that environment's dependencies.
- An existing `~/.local/bin/codex` symlink, which is saved for restoration.

Replace the two example paths with your active Hermes environment. A managed
environment and a development checkout can be different directories. Do not
guess the active runtime or use an unrelated Python interpreter.

```sh
python3 ~/.local/share/jev-router/native_clients.py enable \
  --hermes-root /absolute/path/to/active/hermes/workspace \
  --hermes-python /absolute/path/to/managed/venv/bin/python
```

Add `--hermes-source /absolute/path/to/development/checkout` only when a separate
checkout is also used by your normal Hermes launcher. The combined installer
currently installs Hermes and terminal Codex together; there is no CLI-only setup
command. Unsupported source layouts fail with restoration rather than guessing.

Quit and reopen Hermes, then select `/model jev` for a new chat. It reports
`Selected model: … · reasoning: …`. Its generic `resolve_session_model` hook runs
before prompt construction/compression and lets the standalone plugin choose a
real model. Hermes resolves its own native authentication and destination.
Selected effort persists in primary runtime and saved session metadata. `/new`
resets the actual agent before selecting again.

Configuration updates preserve unrelated fields. Only the exact owned local
`model.base_url` and `HERMES_CODEX_BASE_URL` inference endpoint are removed; the
environment line is journaled without copying other environment values. Explicit
plugin allowlists gain `jev-first-request`. Other providers/endpoints are preserved.
Model pins are profile-scoped, hashed by session ID and bounded to 1,000 entries.
The hook receives only initial task text, session identity, a history-present flag
and non-secret settings. It does not receive the transcript or credentials.

**A Hermes update can overwrite the local core hook.** Revalidate the active
runtime and reapply the extension against the new source after updating. This is
a local integration, not an upstream Hermes feature. The installer journals and
backs up source edits; vendor binaries and authentication stores are untouched.

### Terminal commands

New normal `codex` and `jev-codex` invocations activate immediately. The launcher
uses Desktop's unmodified bundled native CLI; the observed 0.160.0 runtime accepted
Luna on ChatGPT authentication where the older npm 0.153.4 runtime rejected it.
The original npm installation remains unchanged for rollback.

- Interactive Codex connects to a per-process private Unix socket carrying native
  WebSocket-framed RPC. Inference stays inside the native app-server. The directory
  is mode 0700 and socket mode 0600; events stream in fragments.
- `codex exec` selects from the initial task before launching native inference and
  prints real model/effort on stderr. Manual real models skip classification.
- `codex exec resume` restores model/provider/effort from native SQLite metadata,
  without reading rollout history or classifying the follow-up. Explicit model or
  effort overrides win. Missing real metadata uses a visible native fallback.
- Review uses a conservative real fallback. Explicit other providers, local models,
  intentional remote connections, custom Codex homes and utility commands retain
  their normal handling. Stdio `codex app-server` uses the native adapter.

Use normal `codex resume <session-id>` for a later interactive resume. The
per-process Unix socket address printed by the native client is temporary and
does not survive launcher exit.

## Reasoning changes and caching

Preserving conversation input and the same real model makes cached input eligible
for reuse; neither native routing nor an unchanged chat guarantees a cache hit.
Native Codex 0.160.0 supports cache-preserving effort changes behind its
`reasoning_effort_override` feature. Enable it persistently in `~/.codex/config.toml`:

```toml
[features]
reasoning_effort_override = true
```

Add the key to an existing `[features]` table; do not create a duplicate table.
Restart Desktop and terminal Codex processes to load the setting. The native
Desktop adapter and terminal launcher inherit it. Check `codex features list`.
Native Codex gates the behavior on the OpenAI provider and model capability
`supports_reasoning_effort_updates`; Jev does not inject history items itself.
On real `gpt-6.1-sol`, a synthetic native-engine test retained 18,944 cached input
tokens across low → high and 19,072 across high → low. With the feature off, the
first high request lost the warmed prefix. This is engine-level evidence, not a
guarantee of cache availability on every request or acceptance of every UI control.
See [OpenAI's native implementation](https://github.com/openai/codex/pull/43110).

### Hermes native effort updates

The native Hermes integration now appends trusted `configuration_update` items
while keeping the initial request-level `reasoning.effort` unchanged. Hermes
retains its own tools, memory and agent loop. Jev still classifies only the first
task; no inference proxy or classifier is used for effort changes.

New native-client installations include this extension when the current Responses
source surface exists. For an existing native-client installation:

```sh
jev-router hermes-effort-enable
# Restart Hermes, then use its ordinary command:
/reasoning high
```

`/reasoning` updates the live supported agent and its primary-runtime settings
instead of discarding it. The current effort is merged into SQLite session
metadata. A private, profile-scoped `cache/jev-effort` journal stores only effort,
item offsets and SHA-256 fingerprints, allowing ordered updates to replay on cold
resume without storing prompts, tool output or credentials. The journal is
bounded to 256 updates per session; exceeding that starts a fresh baseline and
can lose cache reuse. State I/O failures fall back to the ordinary request.

Replaced history, changed instructions/tools/model/provider and successful local
compression start a new baseline with a fresh update before the next user input.
Failed compression that keeps the prefix does not reset it. Scope is private to
the Hermes profile and session; side-question/fork turns do not edit parent state.

The gate covers exact GPT-6 Sol/Astra/Luna slugs on direct OpenAI API or native
ChatGPT Codex endpoints, in standard single-agent mode. Pro mode, automatic API
compaction, truncation, other providers and unsupported models keep ordinary
request-level effort behavior. OpenAI disallows those combinations with effort
updates; they do not receive a cache-preservation claim. Hermes' local summarizer
remains available. See
[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
and [reasoning changes](https://developers.openai.com/api/docs/guides/reasoning#change-reasoning-mid-conversation).

Hermes also offers an optional `codex_app_server` runtime that can inherit Codex's
feature. It changes tool execution: Codex runs the loop, and Hermes documents that
`delegate_task`, `memory`, `session_search` and `todo` are unavailable. This is not
an automatic migration; keep the default Hermes runtime when those tools matter.

Live Sol probes retained 7,808 cached tokens on low → high, 7,808 on SQLite cold
resume, 7,936 on high → low, then 8,704 on low → high after local compression and
8,576 on the return to low. The compressor used a deterministic test summary;
subsequent inference was real. An unchanged low-effort control also missed once,
so these observations establish prefix eligibility, not guaranteed hits.

`jev-router doctor` checks owned extension hashes. Roll back only this extension
with `jev-router hermes-effort-disable`, then restart Hermes. Source updates can
replace these hooks; revalidate compatibility after Hermes upgrades. Restoration
preserves user edits and keeps dependent extension files together on conflicts.

Changes to tools, instructions, compaction, retention or the model can also
affect reuse.

## Verify and restore

Run a bounded synthetic first task, follow-up, cold resume and manual real-model
task. Require one `native-first-request` selection, saved native model/provider
metadata and no Jev HTTP inference receipts for that chat. The current doctor
checks mainly describe legacy configuration; it does not establish native client
activation. See [dated evidence and remaining checks](VALIDATION.md).

```sh
~/.local/bin/jev-router native-clients-disable
```

Restart Hermes after rollback. This restores the original CLI launcher and owned
Hermes source/configuration/environment changes, preserving unrelated edits and
reporting conflicts. It does not disable Desktop's separate adapter. To restore
Desktop's prior mode, run `jev-router desktop-native-disable` and restart Desktop.

Ownership is recorded in `~/.config/jev-router/native-clients.json` and
`native-desktop.json`; private backups are under `~/.config/jev-router/backups/`.
Never publish these journals, configurations, backups or raw client logs.
