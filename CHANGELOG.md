# Changelog

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
