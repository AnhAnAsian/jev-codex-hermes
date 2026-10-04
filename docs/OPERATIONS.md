# Operations and recovery

## Native first-request routing for Codex Desktop

`jev-router desktop-native-enable` installs an opt-in adapter at Desktop's native
app-server interface. Restart Desktop after enabling it. Jev sees only the first
human task text and selects a real model/effort before the first inference call.
Native Codex then sends every inference request directly to OpenAI, including tool
loops, screenshots, compaction and followups. Its history never passes through the
HTTP Jev gateway. A native model selection skips classification entirely.

The adapter uses `CODEX_CLI_PATH`, a runtime override exposed by the inspected
Desktop build. It forwards commands to the bundled, unmodified Codex runtime and
rewrites only native model/provider startup settings and first-turn model/effort.
Unknown RPC requests, tools, approvals and notifications pass through. Jev picker
rows are added to Desktop's model-list reply; the native model catalog contains
only real models, including for subagents. After selection, Desktop can show the
chosen real model. Desktop restores its original optimistic model parameters on
`turn/started`, which can otherwise replace the real-model label with Jev. For
routed chats, the adapter replays the latest confirmed native
`thread/settings/updated` notification immediately after that event. This display
update preserves the runtime's permissions and collaboration settings and does
not change inference requests or cache configuration. It never invents settings
when no native notification was observed. Use the native model picker for
subsequent manual changes.

The user LaunchAgent `ai.typesafe.jev-router.native-desktop` sets the GUI runtime
override on login. `native-desktop.json` records ownership and the previous mode;
`native-real-models.json` contains only model metadata. No app binary is patched,
and no login/token store is modified. Classification is still sent to the
configured Jev backend. The native RPC interface is experimental: validate the
adapter against a new Desktop runtime after updates.

Cold resume switches previously stored `jev` provider chats to direct OpenAI while
preserving their saved real model and reasoning effort. For old virtual-model
chats, recent served-model receipts can recover the previous selection. If those
receipts are unavailable, the adapter uses the configured fallback while waiting
for the first human task. Existing already-running chats require a Desktop restart
to move off the HTTP gateway. Other providers are preserved.

`jev-router desktop-native-disable` restores the prior runtime override and mode;
restart Desktop to apply it. `desktop-disable` also removes native mode before
restoring the original Desktop provider/catalog. Restoration preserves user edits
and reports ownership conflicts. Backups live in private `backups/native-first-*`.

The HTTP gateway remains available for legacy Hermes, Claude and legacy launchers. Its
payload limit does not apply to Desktop inference in native first-request mode.

For Hermes and terminal Codex setup, prerequisites and rollback, see
[native client routing](NATIVE-ROUTING.md).

## Legacy proxy installation

Installed code: `~/.local/share/jev-router/`. Private state:
`~/.config/jev-router/`. The user LaunchAgent is
`~/Library/LaunchAgents/ai.typesafe.jev-router.local.plist`.
Backups are timestamped before configuration writes. `integration.json` and
`desktop-picker.json` record owned fields for selective restoration.

The installer defaults to Codex Desktop; Hermes and Claude require explicit
flags. Hermes stays on its existing provider. Codex uses a custom Responses
provider with `requires_openai_auth=true` and a local model catalog. No client
binary is patched. A hook is installed only in the optional `hook-subagent`
fallback mode; true picker routing does not require a new hook.

## Disable and uninstall

Use `jev-router disable`, then restart clients to restore direct operation.
Use `desktop-disable` plus Desktop restart to disable only Desktop. The stop
command restores clients before stopping the listener. A crash/unmanaged stop
can interrupt a client still pointed at the proxy; fail-open classification
does not mean an absent proxy can forward requests.

`jev-router uninstall` restores owned fields, unloads startup and removes owned
command shims. It retains installed code and private backups for recovery.
After confirming normal clients work, delete `~/.local/share/jev-router/` and
`~/.config/jev-router/` to remove all remaining code, keys, logs and backups.
Deletion of those backups is permanent; retain them until recovery is complete.

Restoration preserves user-modified fields and reports conflicts. Desktop
provider conflicts keep the ownership journal active: resolve the reported
provider edit, then run `desktop-disable` again before re-enabling. Do not
overwrite whole client config files or blindly copy a backup over new settings.
Changing the listener port requires regenerating client integrations; disable,
edit the port, restart the service, then enable and restart clients.

## Existing installation / adapter migration

The initial installer refuses to replace existing code or state. The original
development installation has been migrated to this adapter; a fresh checkout and
the running installation remain separate directories. Pulling Git does not update
installed code, configuration or startup registration.

To migrate intentionally: validate the new checkout first, record current
mappings, use the old installation's disable/stop commands, and make private
copies of code and state. Stage the new code beside the old copy rather than
merging directories blindly. Preserve the unchanged upstream checkout or run
bootstrap for the release lock. Verify dependencies, then replace code and
regenerate startup registration with `python3 manage.py install-service`.
Use the matching CLI to enable and repeat live acceptance. Keep the previous
copy for rollback. A zero-downtime adapter upgrade is not implemented.

## Upstream updates

The legacy `jev-router update` fast-forwards an installed upstream Git checkout,
installs locked dependencies, runs upstream/adapter suites and restarts only
after success. It rolls back the upstream revision when checks fail. This is
an opt-in moving update; it does not rewrite the release lock or update this
adapter. Prefer deliberate release changes for reproducible deployments.

Legacy proxy pins do not survive service restarts. Native clients restore saved
real selections from metadata/pins. Do not treat an unchanged legacy Jev picker
label as a persistent backend-model guarantee after updating/rebooting.

## Large conversations and screenshots

Legacy HTTP/WebSocket inference requests have a 128 MiB default payload limit. Older configurations
without `maxPayloadBytes` use this default too. The limit covers HTTP requests,
WebSocket frames and queued WebSocket bytes; settings/advice endpoints retain
their smaller limits. To override it, set the top-level `maxPayloadBytes` field
in private `config.json` to an integer from 1048576 (1 MiB) to 536870912 (512 MiB),
then restart the router. `/health` reports the active `maxPayloadBytes`.

Oversized HTTP requests return JSON with `error.code: payload_too_large`, the
observed payload bytes (a lower bound for a rejected chunked request), the limit
and recovery guidance. WebSockets close with code 1009. Logs contain size metadata
only, never the request contents or auth headers. Upstream providers can enforce
their own limits even when a request passes this local limit.

Screenshot bytes and model tokens are different budgets. Prefer the model's
advertised context/compaction defaults in Codex; increasing a local context-window
override does not establish a larger provider capacity or prevent image payloads
from hitting a byte limit. Compact long visual-review conversations when needed.

In legacy proxy mode, all Desktop picker models use the configured provider. Real model selections
(for example Sol) pass through this proxy without classification, model changes,
reasoning changes or JSON reserialization. Choosing a native model does not switch
to direct transport. Use `jev-router desktop-native-enable` and restart Desktop
for direct inference while retaining Jev selection, or `desktop-disable` and
restart to restore the original configuration. `desktop-enable` and restart
restore the legacy proxy picker.

## Config edits and catalog refresh

An invalid live configuration returns degraded health (503), while inference
continues with the last validated snapshot. Repair the configuration to resume
normal health. Startup still requires a valid config. `refresh-catalog` updates
both generated catalogs and the running service metadata; restart Desktop to
reload its picker. Only explicit supported Hermes providers are integrated.

## Browser settings

Use `jev-router settings` for common routing controls. Each save validates a merge,
creates a private config backup and reloads settings without restarting the service.
Model ID changes require `refresh-catalog` and Desktop restart for accurate context
limits. Keys, endpoints and client activation remain advanced operations. See
[SETTINGS.md](SETTINGS.md).

## Hermes picker metadata

`jev-router hermes-picker` advertises `gpt-jev-auto`, `gpt-jev-luna` and
`gpt-jev-sol` under Hermes's supported `providers.openai-codex.models` overlay.
It requires an active owned integration pointed at this proxy. It preserves
provider credentials, real model metadata, aliases and unrelated fields, and
records its additions for selective disable/uninstall restoration. The proxy
also adds these IDs to the live Codex catalog and hides the legacy alias.

Refresh models or restart Hermes after registering the metadata. The native
composer may still honor its separately saved visible-model shortlist; searching
for `jev` searches the entire provider catalog. A user-saved legacy custom row
can still appear: this adapter does not edit desktop preferences. Inline non-empty
provider/model YAML blocks are refused without mutation; expand them to ordinary
block YAML before registering the overlay. This legacy registration changes no
Hermes code/binary; the separate native extension does add a reversible source hook.

## Diagnose the right client

The profile editor changes maps, not providers or logins. For picker IDs, Hermes
aliases, the optional Anthropic route and Claude Desktop's advice-only workflow,
use [the client guide](CLIENTS.md). Claude Desktop Chat/Cowork are not enabled by
the `--claude` installer flag; that flag targets the Claude Code terminal client.

The local advice page and settings page use the existing listener. Keeping them
open does not verify model generation. Compare a bounded client's response with
its routing receipt using [the live acceptance checklist](VALIDATION.md).

## Hermes and terminal native first-request routing

See [the setup guide](NATIVE-ROUTING.md#hermes-and-terminal-codex) for exact installed
command paths, prerequisites, current combined-installer scope and cache limits.

`native_clients.py enable --hermes-root <active-Hermes-source> --hermes-python <managed-environment-python> --hermes-source <optional-development-source>` installs a standalone `jev-first-request` plugin, a generic Hermes `resolve_session_model` hook, and an owned terminal `codex` launcher. Hermes configuration writes use its public atomic round-trip writer. Only Jev's exact local inference endpoint is removed; other providers and endpoints remain unchanged. Explicit plugin enable lists gain the new plugin. Configuration, source files, and original launcher symlink are journaled and backed up.

The hook runs before system-prompt construction and compression. Its payload contains only the new human input, `has_history`, session identity, and non-secret route settings. It never receives conversation history or credentials. Model/provider/effort results are validated; Hermes resolves native authentication and rebuilds its own clients. A resumed prefix stays unchanged, and effort is retained in the primary runtime. The plugin classifies only new virtual-model chats, stores bounded profile-scoped model pins, skips real manual selections, and uses a real fallback for a legacy resumed alias with no pin. Existing aliases can still be selected for new chats.

Interactive terminal Codex uses its supported `--remote unix://...` connection to a per-process, owner-only Unix socket. WebSocket-framed RPC reaches the same native stdio adapter as Desktop. Inference, tools, permissions and compaction stay in the native app-server. Events are forwarded in fragments rather than buffered into whole lines by the socket bridge. `codex exec` resolves its initial task before launching native inference and prints selected model/effort to stderr. Exec resume reads saved model/provider/effort from native SQLite metadata and restores them explicitly, without reading rollout history or classifying the follow-up. Older virtual pins can be recovered from metadata-only routing receipts; if a real pin is unavailable, the profile fallback is shown. Explicit model and effort overrides take precedence. Review uses the profile's conservative real fallback. Explicit other providers, intentional remote connections, local-model mode, custom Codex homes, and utility commands are preserved. The normal stdio `codex app-server` command uses the adapter.

`jev-codex` and `jev-hermes` respect this native mode instead of adding proxy endpoint overrides. The installer also removes only the exact owned `HERMES_CODEX_BASE_URL` endpoint from profile `.env` files, journaling that line alone and preserving every other value. This is necessary because that endpoint overrides YAML. Routed legacy agents explicitly resolve the configured native destination. The terminal uses Desktop's current native binary because older Codex runtimes can reject GPT-6 models on ChatGPT authentication; the original npm installation remains unchanged. Restart Hermes to load the extension. New terminal invocations activate immediately. A Hermes update can replace its generic core hook; revalidate/reapply the extension against the new active runtime before relying on automatic routing. No vendor binary or authentication token store is patched.

Rollback: `jev-router native-clients-disable`. Ownership checks preserve later user edits and report conflicts. Restart Hermes after rollback. This restores the prior CLI launcher and Hermes proxy configuration; it does not disable the separate Desktop adapter.
