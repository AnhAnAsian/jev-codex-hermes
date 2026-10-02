# Jev for Codex Desktop and Hermes

An experimental macOS adapter around [flaviusapop/jev-router](https://github.com/flaviusapop/jev-router).
Select **Jev** in the normal Codex Desktop picker or `/model jev` in Hermes.
Jev classifies the first task, chooses a real model and reasoning effort, and
keeps them for the conversation. The original clients handle tools, permissions,
sessions and OAuth. No parent model runs before the classification decision.

This is a small integration layer, not a new classifier or a large gateway.
The upstream classifier questions and routing policy are reused unchanged.

## Architecture

```text
Codex Desktop / CLI ─ custom Responses provider ─┐
Hermes ─ original Codex OAuth provider ───────────┼─ 127.0.0.1:48767
Claude Code ─ optional Anthropic integration ────┘         │
                                                         ├─ Jev classification
                                                         └─ original subscription endpoint
```

Only classification uses OpenRouter credits or a TypeSafe key. Coding model
traffic stays on the original provider. Astra/Fable are absent from default
automatic maps. The localhost service forwards client auth/account headers
transiently, without storing OAuth tokens or opening client credential stores.

**Privacy:** classification sends up to 8,000 characters of task text to Jev
through the selected classifier backend. Default logs contain routing metadata
and safe model receipts, never prompts, code or auth headers. Read [SECURITY.md](SECURITY.md).

## Install on macOS

Requires Node 22+, Python 3.11+, Git, and an existing Codex Desktop login/config
with `gpt-6-luna` and `gpt-6.1-sol` in its cached catalog. Open Desktop once first.
Model names and capabilities depend on the client/account; defaults are not
a guarantee of availability. The service installer is macOS-only.

```sh
git clone https://github.com/AnhAnAsian/jev-desktop-hermes.git
cd jev-desktop-hermes
npm ci --ignore-scripts
npm run bootstrap
npm run validate
python3 scripts/install.py --hermes
```

Omit `--hermes` for Codex only. Add `--claude` only to opt into the experimental
Claude Code adapter. The installer preserves existing installations and refuses
collisions; it does not replace a running personal setup. See [operations](docs/OPERATIONS.md)
for migration and recovery.

In your own terminal:

```sh
~/.local/bin/jev-router key --openrouter
~/.local/bin/jev-router doctor
```

Key entry is hidden and saved outside the source tree with owner-only permissions.
For direct TypeSafe classification, set `classifier.provider` to `typesafe` and
run `jev-router key`. Never paste a key into chat or a Git commit.

Restart enabled clients. Select **Jev** in a new Desktop chat, or `/model jev`
in Hermes. No terminal wrapper is needed for normal Desktop use. A user LaunchAgent
starts the service at login. Add `~/.local/bin` to PATH for shorter commands.

## Default mappings

| Tier | Codex / Hermes Codex provider | Reasoning |
|---|---|---|
| FAST | `gpt-6-luna` | medium |
| BALANCED | `gpt-6.1-sol` | low |
| STRONG | `gpt-6.1-sol` | high |
| LONG | `gpt-6.1-sol` | xhigh |

Optional **Jev Luna** / **Jev Sol** stay within their family with
low / medium / high / xhigh efforts. Their IDs are local virtual catalog entries,
not real provider models. The proxy translates them before inference.

Claude defaults are Haiku 4.5 without effort, Sonnet 5.5 high, Opus 5.5 high,
and Opus 5.5 xhigh. Account access and live Claude generation are unverified.

All maps: `~/.config/jev-router/config.json`. `disabledTiers` disables tiers.
Instructions such as “use fast tier” bypass classification. A regular model
selection passes through unchanged. The picker effort label does not dynamically
show the effort Jev applies; inspect receipts instead.

## Everyday commands

```sh
jev-router status
jev-router logs --follow
jev-router disable   # Restore client settings; restart clients afterward
jev-router enable    # Reinstall routing; restart clients afterward
jev-router restart
```

`stop` restores clients and disables startup; `start` starts the service and
registration, while `enable` installs client routing. `desktop-disable` restores
only Desktop's provider/catalog; `desktop-enable` reinstalls them.
The [localhost advice page](http://127.0.0.1:48767/) offers manual recommendations.

## Evidence and limits

Normal Desktop parent routing and Hermes task/resume routing were observed on
the original development machine: provider metadata reported the selected real
model. Family variants also passed bundled-engine/Hermes smoke checks. Reasoning
effort is verified outbound, not independently acknowledged by provider metadata.
Private session receipts are deliberately not included in this repository.

The synthetic adapter suite covers routing, loops, overrides, family restrictions,
headers, streaming and origins. Configuration tests exercise merges/restoration
in temporary directories; CI requires no paid keys or client logins. See
[validation](docs/VALIDATION.md) for live acceptance tests and supported versions.

Conversation pins are in memory and are lost on service restart. Explicit
overrides can change effort/model. Cache hits are not guaranteed. This adapter
does not implement cache-preserving `configuration_update` items. Comprehensive
Desktop Computer Use, compaction, all real coding tiers and Claude authentication
remain unverified. Linux CI tests the adapter, not a Linux startup installer.

## Development and updates

`upstream.lock.json` pins the unchanged upstream. `npm run bootstrap` clones it
and installs its locked dependency; upstream code is excluded from this repo's
Git index. `npm run validate` checks the adapter; `npm test --prefix upstream`
checks upstream. CI runs both on macOS and Linux.

`jev-router update` updates the installed upstream checkout and checks both suites;
it does not update adapter code. For a reproducible release, intentionally update
the lock and re-run validation. Read [operations](docs/OPERATIONS.md) before
changing an installed copy.

Licensed MIT. See [NOTICE](NOTICE) for upstream attribution. Independent project;
not affiliated with OpenAI, Anthropic, OpenRouter, TypeSafe or upstream maintainers.
