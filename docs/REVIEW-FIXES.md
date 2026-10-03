# Review fixes — 2026-10-03

All nine defects in the initial repository review have regression coverage.
The upstream classifier, questions and decision policy remain unmodified.

| Finding | Fix / regression |
|---|---|
| Accidental extra-credit selection | Exact model and tier directives must start the human prompt with `use` / `switch to`. Model comparisons, negation, quoted instructions and code do not override routing. An explicit `Use model: gpt-6-astra: …` or native picker still counts as manual selection. |
| Tool-only continuation loses pin | Established state precedes the auxiliary guard; a two-message WebSocket regression omits repeated tools and verifies identical model/effort. Connection identity stays stable when cache metadata is omitted. |
| Formatting breaks Desktop restore | Parsed TOML provider ownership governs removal. Whitespace, comments and field reordering restore cleanly. Genuinely modified/nested provider tables remain intact with an active conflict journal until resolved. |
| Exact Haiku bypasses normalization | Final model capability normalization covers selected tiers, exact overrides, variants and disabled/error fallbacks. Haiku strips unsupported thinking, effort and thinking-pruning strategies; GPT efforts clamp to catalog support. |
| Unsupported Hermes provider | Explicit allowlist and transport validation run before backups or client writes. Unsupported OpenRouter/Ollama/custom integration is rejected without converting authentication. |
| Invalid config crashes health | Whole-snapshot schema validation precedes environment changes; request errors are contained. The service retains its last valid snapshot for inference; health returns 503 and `config_state: last-valid` until repaired. |
| Installer Python / partial failure | Initial enable receives the verified `JEV_PYTHON`. Failure invokes journal restoration, removes owned partial installation/startup/shims and retains private recovery backups. Incomplete restoration preserves the installation/journals. Regression applies and restores a real temporary Desktop config. |
| Runtime catalog starts empty | Startup seeds real model metadata from the client cache or generated catalog; health refreshes it. Tests route without a network model-list request and validate availability/effort clamping for variants. |
| Refresh writes wrong file | `refresh-catalog` regenerates both runtime and Desktop picker catalogs, refreshes service metadata, and directs a Desktop restart. Tests read the actual TOML-configured catalog path. |

Additional hardening: consistent exact browser Origin checks, identifiable service
health, bounded WebSocket input queue, bounded auxiliary state Sets, protocol-based
served-model receipts, immutable CI action revisions and monthly dependency checks.

## Verification and deployment scope

The gate includes mock HTTP/WebSocket providers, temporary client homes, installer
failure recovery and unchanged upstream tests. No production OAuth files, paid
model generations or classifier calls are needed. See VALIDATION.md for separate
normal-client acceptance checks; mock served-model receipts prove the rewrite and
transport, not that a live provider served those models.

This repository patch does not replace/restart the separately installed personal
router. Use the migration procedure in OPERATIONS.md to deploy a validated release.
Conversation pins still live in memory and reset on restart; durable pins and new
provider transports are future features, not fixes included in this release.
