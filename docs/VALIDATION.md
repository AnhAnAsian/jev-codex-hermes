# Validation

Development observations from 2026-10-02: Codex Desktop 26.928.20755 / bundled
engine 0.159.0, standalone CLI 0.153.4, Hermes 0.21.5+3698.g6f7a799, Claude Code
2.1.259, Node 22 and Python 3.11+. Model availability is client/account-specific.

## Automated gate

```sh
npm ci --ignore-scripts
npm run bootstrap
npm run validate
npm test --prefix upstream
```

Mocked classifier/provider tests verify model/effort rewrites, pinning, manual
overrides, streaming, opaque headers, origin checks and metadata logging.
Temporary-home Python tests verify selective client installation and restoration.
They do not prove the normal Desktop app or provider accepts a request.

## Live acceptance on your account

First run `jev-router doctor` and `jev-router classify-test`. The latter tests
classification only. Its deep architecture prompt previously classified STRONG
at 0.48 confidence; expected labels are test expectations, not forced outcomes.

In a fresh normal Desktop chat select Jev and submit a bounded no-tool task.
Compare the routing receipt with `served_model` from the actual response; a
picker label or classifier result alone is not evidence. Submit a follow-up
and confirm `conversation-pinned` with no new classifier latency. Repeat via
Hermes `/model jev`; use `jev-codex` separately to check standalone CLI behavior.
Family choices should remain within Luna/Sol. Outbound effort is distinct from
independently verified provider effort.

Representative classification tasks: “Rename a variable and fix a typo.”,
“Add a small API endpoint following the existing project pattern.”,
“Debug an intermittent concurrency bug whose cause is unknown.”, and a genuinely
architecture-heavy distributed-system design/proof task. Verify the served model
when running actual client tasks, not just expected classifier labels.

Restore Claude's own login before testing its optional route. Earlier live Claude
inference could not be verified because OAuth refresh failed. A successful auth
status command alone does not prove refresh/generation works.

Computer Use, broad compaction/resume, all coding tiers in normal Desktop, family
entries in normal UI and reboot behavior remain separate acceptance checks.
CI is credential-free; passing it is not evidence of these live behaviors.

## Settings acceptance — 0.2.0 / 2026-10-03

The settings page was exercised in a real browser at desktop and 390 px mobile
widths: reasoning changes saved and persisted after reload, mobile layout had no
horizontal overflow, and the installed page had no console errors. A live save
of unchanged settings preserved the private config byte-for-byte and created a
backup. Tests cover invalid/unknown fields, stale revisions, origin/token checks,
payload limits, metadata redaction and existing-chat pinning after map changes.

The original development Mac was upgraded to 0.2.0 with private code/state/startup
backups. Health and localhost binding passed. Live Jev classification responded;
Hermes returned `4` for a bounded arithmetic task and the primary response metadata
confirmed FAST / `gpt-6-luna`, with `medium` verified outbound only. A separate
auxiliary Hermes request used the configured Sol fallback. Claude login still
failed doctor. Post-upgrade normal Desktop generation, reboot, Computer Use and
compaction remain separate acceptance checks; opening the settings page does not
verify Desktop generation.

## Dropdown acceptance — 0.2.1 / 2026-10-03

Native model dropdown opening/selection, save/reload persistence, provider changes
with pending edits, custom-ID retention, discard, disabled-tier controls and a
390 px layout were exercised in the Codex in-app browser against isolated example
state. The browser reported no errors and no horizontal overflow at 390 px.
The installed configuration remains separate from that test fixture.

## Routing profiles / Hermes picker registration — 0.3.0

The browser editor saved a Luna-only effort change independently of mixed/Sol
maps; it persisted after reload. The installed page exposes mixed Jev, Jev Luna,
Jev Sol and Claude maps, plus separate Codex/Hermes/Claude timing. Existing router
configuration was preserved during the code upgrade. Hermes received only the
owned `providers.openai-codex.models` additions, with a private configuration backup.
The normal first-party `hermes config get providers.openai-codex.models` command
confirmed all three canonical IDs. Alias commands and catalog declarations remain
separate; the adapter now supplies both, without patching Hermes code or binaries.

Live first-party CLI arithmetic probes returned `4` with served-model metadata:
mixed Jev → GPT-6 Luna / high outbound; Jev Luna → GPT-6 Luna / low outbound;
Jev Sol → GPT-6.1 Sol / low outbound. Luna completed with exit 0; the two initially
capped two-turn probes exited nonzero, then both completed with exit 0 under the
normal six-turn allowance. Reasoning effort is still verified outbound only.
Native Hermes GUI visual acceptance remains pending: the native UI connection
timed out. Reopen/refresh its model menu and search for `jev` to confirm its cached
view reloads. The standalone Python catalog probe was abandoned because its
assumed dependency environment did not match the normal launcher.
