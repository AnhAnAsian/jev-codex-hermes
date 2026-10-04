# Changelog

## Unreleased

- Correct effort-cache guidance: native Codex 0.160.0 already implements trusted
  configuration updates behind `reasoning_effort_override`. Document persistent
  setup and live Sol low/high cache evidence. Hermes' default runtime remains
  separate; its optional Codex runtime changes tool availability.

### Native first-request routing — 2026-10-04

- Add opt-in native Desktop routing through a reversible `CODEX_CLI_PATH` override.
  Select a real model/effort from the initial human input, then keep inference,
  tools, compaction and history inside the unmodified native OpenAI client.
- Add the Hermes `resolve_session_model` hook and standalone first-task plugin,
  with bounded profile-scoped pins, native provider resolution, visible selection,
  persisted reasoning and actual-agent reset on `/new`. Remove only the exact
  owned proxy endpoint from YAML and profile environment overrides.
- Add the terminal native app-server bridge over a private Unix socket, first-task
  exec selection, manual-model bypass and metadata-only resume restoration.
  Explicit manual settings and other providers retain their normal handling.
- Add reversible client installation with source/configuration backups and
  launcher ownership checks. Document opt-in setup, Hermes update requirements,
  native-mode evidence and the unverified cache behavior when effort changes.
- Raise the legacy HTTP/WebSocket payload limit from 32 MiB to a configurable,
  bounded 128 MiB default. Return actionable size-only errors, preserve WebSocket
  close code 1009 and forward manual Codex requests without JSON reserialization.

Fixed the native Desktop model picker reverting to Jev when a routed turn starts.
Replay confirmed native model/effort settings after Desktop restores its original
turn parameters. Inference remains direct; large native events still stream
without whole-event buffering. Added notification-ordering regression coverage.

Public-release preparation: clearer verified client scope and experimental
Anthropic API-auth boundaries, tested-version snapshot, external classification
cost/privacy notice and explicit cache/quota limits. Added a concrete GitHub
security-reporting policy, checksum-pinned full-history secret-scan workflow and
a tested helper for post-publication security activation that never publishes
the repo or enables paid Advanced Security. Added release/clone-recovery guidance.

Renamed the repository/package to `jev-codex-hermes`, with display name
**Jev for Codex & Hermes**. Updated clone commands and CI badge links. The internal
health service identifier remains `jev-desktop-hermes` for compatibility with
existing CLI checks; installed commands, state paths and startup are unchanged.

Documentation polish: new routing-diagram banner, visible settings preview,
clear client/evidence matrix and a focused client troubleshooting guide. Explicitly
separated Claude Code terminal from Claude Desktop Chat/Cowork, clarified Anthropic
provider activation and subscription limits, and corrected migration guidance.
Added contribution instructions. Runtime, release version and installed settings
are unchanged.

## 0.3.0 — 2026-10-03

Editable routing profiles for mixed Jev, Luna-only, Sol-only and Claude; separate
Codex/Hermes/Claude selection timing. Saves preserve profile extension fields and
reject cross-family models. Catalog refresh includes profile fallback capacity.
The proxy advertises all three canonical Jev picker IDs and hides the legacy alias.
Hermes receives reversible supported provider-model metadata via `hermes-picker`,
independent of alias commands and live discovery. No Hermes client code changes.

## 0.2.1 — 2026-10-03

Replaced unreliable datalist model inputs with native model/fallback dropdowns.
Added capability-aware reasoning choices, explicit custom IDs, unlisted-ID and
additional-credit warnings. Improved compact/responsive layout, accessible labels,
advanced disclosure, sticky save feedback, discard and accurate dirty tracking.
Provider changes retain drafts; save/load freeze edits and have bounded timeouts.

## 0.2.0 — 2026-10-03

Added a localhost settings page and `jev-router settings`: editable tier maps,
reasoning, pause/resume, routing mode, fallback and classification limits. Saves
validate a bounded merge, create private backups and reject stale revisions.
Browser writes require same-origin and an anti-CSRF token. Refreshed the GitHub
README with a routing banner, settings preview and installation/upgrade guidance.

### Review fixes

Fixed all nine initial review findings with routing, capability, configuration
recovery, runtime catalog and installer regression tests. Added safe config
snapshots and localhost/queue/CI hardening. See docs/REVIEW-FIXES.md.
The separately installed personal router is unchanged.

## 0.1.0 — 2026-10-02

Initial experimental macOS adapter release. Supported Codex provider/catalog
integration, Hermes aliases on the original Codex OAuth provider, OpenRouter
or TypeSafe Jev classification, conversation pins, optional family maps,
metadata-only receipts, localhost advice UI and reversible LaunchAgent setup.

Packaging adds a pinned upstream bootstrap, opt-in client merges, portable
Python selection, current Desktop diagnostics and configuration regression
tests. The installed personal service was not replaced by this release.
