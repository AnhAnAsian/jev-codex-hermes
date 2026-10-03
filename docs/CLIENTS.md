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

These IDs are proxy aliases, not upstream models. The service replaces them with
a real model and reasoning effort before sending the request to the Codex
subscription endpoint. Codex retains responsibility for OAuth login and refresh.
Selecting a regular real model preserves manual operation.

The displayed effort next to Jev may differ from the effort sent upstream. Inspect
`jev-router logs --follow` for the routing receipt and `served_model`; the outbound
effort is not independent confirmation from the provider.

For the CLI, use the shared provider configuration or the installed `jev-codex`
launcher. If Desktop is missing profiles, run `jev-router refresh-catalog`, restart
Desktop, and check `jev-router doctor` before changing any client files.

## First-party Hermes on Codex OAuth

This integration targets the first-party Hermes client and supported Hermes
configuration. It does not patch Hermes or a third-party desktop wrapper.

| Chat command | Model ID |
| :--- | :--- |
| `/model jev` | `gpt-jev-auto` |
| `/model jev-luna` | `gpt-jev-luna` |
| `/model jev-sol` | `gpt-jev-sol` |

Hermes keeps the `openai-codex` provider and its existing ChatGPT/Codex login.
Requests use `/hermes/codex` on the localhost proxy. Model aliases and picker
catalog entries are separate: the adapter installs both, including the supported
`providers.openai-codex.models` overlay.

If a command works but the picker is missing a profile:

1. Run `jev-router hermes-picker` to register owned catalog entries.
2. Restart Hermes or refresh its model menu.
3. Search for `jev`; a saved visible-model shortlist may hide entries otherwise.

The legacy `jev-auto` alias remains accepted but is hidden from the proxy catalog.
A separately saved custom row can still appear. The adapter leaves native desktop
preferences alone. All three profile responses were verified in the first-party
CLI; visual acceptance of the refreshed native GUI remains outstanding.

## Hermes on Anthropic

The installer also accepts an already configured `anthropic` or `claude` provider
using a supported Messages transport. It points that provider at `/hermes/claude`
and sets the virtual model to `jev-auto`. It preserves the existing provider and
credential handling rather than converting Codex OAuth into paid API usage.

This route uses the **Claude / Anthropic** map. Luna/Sol maps and Codex picker IDs
do not apply. The installer does not add the three Codex aliases to this provider.
Anthropic transport is covered by automated tests; real Anthropic authentication
and generation still require live acceptance. A configured map is not evidence
that those model IDs or effort levels are available on your account.

## Claude Code terminal

The optional `--claude` installer flag merges owned environment settings into
`~/.claude/settings.json`, including the `/claude` proxy base URL, `jev-auto` model
and a custom model option named **Jev Router**. Whether that option appears depends
on the client version; it has not been verified in a live authenticated session.
Unrelated hooks, plugins, MCP servers and settings are preserved.

The integration forwards auth provided by the client; it neither obtains an
Anthropic API key nor reads OAuth tokens. Existing subscription authentication
through this route is **not proven**. Restore the client's normal login and check
real response metadata before relying on it. Do not inject a dummy token or assume
gateway support establishes subscription compatibility.

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
