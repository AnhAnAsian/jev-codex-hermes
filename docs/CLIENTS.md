# Pick the right integration

[README](../README.md) · [Settings](SETTINGS.md) · [Operations](OPERATIONS.md) · [Validation](VALIDATION.md)

The routing profile editor changes maps. It does not change the active model,
provider or login in any client. Choose a profile in the client to use it.

## Codex Desktop and CLI

Use the normal Desktop model picker in a new conversation:

| Display name | Local model ID | Behavior |
| :--- | :--- | :--- |
| Jev | `gpt-jev-auto` | Mixed Luna/Sol map |
| Jev Luna | `gpt-jev-luna` | Luna family only |
| Jev Sol | `gpt-jev-sol` | Sol family only |

These IDs are routing aliases, not upstream models. In opt-in native mode the
adapter resolves them before the first turn; native Codex then sends inference
directly to OpenAI. The legacy mode resolves aliases inside the HTTP proxy.
Codex retains responsibility for OAuth login and refresh. Selecting a regular
real model skips classification.

Native Desktop confirms the selected real model/effort after turn-start
restoration, preventing the picker from reverting to Jev. The legacy proxy does
not synchronize the picker. Inspect routing and response metadata; outbound effort
is not independent confirmation from the provider.

The native terminal launcher supports normal `codex`, interactive/exec/resume and
`jev-codex`; it uses the current bundled Desktop runtime. Follow
[native setup and limits](NATIVE-ROUTING.md). If Desktop is missing profiles, run
`jev-router refresh-catalog` and restart Desktop. `doctor` mainly checks legacy
configuration; native activation needs a live first-turn/follow-up check.
For a legacy SSH host, run `jev-router desktop-check` on the host. If it reports a
pending reload, finish chats, run `jev-router desktop-reload`, then reconnect.
See [SSH recovery](OPERATIONS.md#ssh-codex-shows-custom--benutzerdefiniert-or-stalls-after-the-first-message).

## First-party Hermes on Codex OAuth

This integration targets the first-party Hermes client and supported Hermes
configuration. Native mode adds a standalone plugin and a reversible generic
core hook to the active Hermes source; it does not patch a vendor binary or a
third-party desktop wrapper. The legacy integration changes configuration only.

| Chat command | Model ID |
| :--- | :--- |
| `/model jev` | `gpt-jev-auto` |
| `/model jev-luna` | `gpt-jev-luna` |
| `/model jev-sol` | `gpt-jev-sol` |

Hermes keeps the `openai-codex` provider and its existing ChatGPT/Codex login.
Native mode selects only from the first task, reports the real model/effort and
uses direct native inference. Follow-ups and resumes retain the selected model;
manual real models bypass classification. Restart Hermes after installing the
extension. An update can replace its local core hook; revalidate afterward.
Legacy mode uses `/hermes/codex` on the localhost proxy. Model aliases and picker
catalog entries are separate: the adapter installs both, including the supported
`providers.openai-codex.models` overlay.

In legacy mode, if a command works but the picker is missing a profile:

1. Run `jev-router hermes-picker` to register owned catalog entries.
2. Restart Hermes or refresh its model menu.
3. Search for `jev`; a saved visible-model shortlist may hide entries otherwise.

The legacy `jev-auto` alias remains accepted but is hidden from the proxy catalog.
A separately saved custom row can still appear. The adapter leaves native desktop
preferences alone. All three profile responses were verified in the first-party
CLI; visual acceptance of the refreshed native GUI remains outstanding.

## Hermes on Anthropic

**Experimental API-auth route; no consumer subscription/OAuth support is claimed.**

The installer also accepts an already configured `anthropic` or `claude` provider
using a supported Messages transport. It points that provider at `/hermes/claude`
and sets the virtual model to `jev-auto`. It preserves the existing provider and
credential handling rather than converting Codex OAuth into paid API usage.

This route uses the **Claude / Anthropic** map. Luna/Sol maps and Codex picker IDs
do not apply. The installer does not add the three Codex aliases to this provider.
Anthropic transport is covered by automated tests; real Anthropic authentication
and generation still require live acceptance. A configured map is not evidence
that those model IDs or effort levels are available on your account.

Use your own authorized Anthropic API credentials and account; API charges are
separate from a consumer Claude plan. The accepted `anthropic` / `claude` labels
describe configuration shape, not permission to relay subscription credentials.
The adapter does not enforce every possible credential source, so selecting an
accepted provider is not authentication-policy validation.

## Claude Code terminal

The optional `--claude` installer flag merges owned environment settings into
`~/.claude/settings.json`, including the `/claude` proxy base URL, `jev-auto` model
and a custom model option named **Jev Router**. Whether that option appears depends
on the client version; it has not been verified in a live authenticated session.
Unrelated hooks, plugins, MCP servers and settings are preserved.

The integration forwards auth provided by the client; it neither obtains an
Anthropic API key nor opens OAuth credential stores. Configure an authorized API
credential using the client's normal secure mechanism and verify a real response
before relying on this experimental route. Consumer subscription routing is not
a supported feature, and working transport would not establish policy permission.
Do not inject a dummy token or extract Claude session credentials.

Anthropic's [authentication and credential-use policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
restricts third-party routing through consumer plan credentials. Their allowance
for an end user signing into an unmodified native Claude Code client does not
establish approval for every intervening third-party router. This project does
not represent either provider's endorsement or approval.

Claude defaults to per-turn classification when `routing.claude` is absent. You can
choose conversation timing in settings. Tool-loop requests remain pinned either way.

## Claude Desktop Chat and Cowork

Automatic routing is **not installed** for these views. The Anthropic map in our
settings page does not add Jev to Claude Desktop's model picker. CLI settings do
not establish a Desktop integration.

Anthropic documents a separate third-party inference deployment with gateway
credentials and model discovery/custom model lists. We have not established a
supported way to reuse the ordinary Claude Desktop subscription login through
our proxy. Changing to that deployment would be a different authentication and
billing setup, not an equivalent extension of the current integration.
See the official [Desktop gateway guide](https://claude.com/docs/third-party/claude-desktop/gateway)
and [surface-specific configuration](https://code.claude.com/docs/en/llm-gateway-connect#desktop-app).

Keep Desktop as it is. Open the local [Ask Jev page](http://127.0.0.1:48767/), submit
the task for advice, then choose the available model manually in Claude Desktop.
The same classification privacy notice applies: task text goes to TypeSafe/Jev
through your configured backend.

## Verify your installation

Run `jev-router doctor`, then use a fresh bounded task and inspect
`jev-router logs --follow`. A classifier result verifies classification; only
response metadata verifies the answering model. Follow [the acceptance checklist](VALIDATION.md)
after client or adapter upgrades. To restore direct clients, run
`jev-router disable` and restart them.
