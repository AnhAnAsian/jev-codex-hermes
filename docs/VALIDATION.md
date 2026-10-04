# Validation

Development observations from 2026-10-02: Codex Desktop 26.928.20755 / bundled
engine 0.159.0, standalone CLI 0.153.4, Hermes 0.21.5+3698.g6f7a799, Claude Code
2.1.259, Node 22 and Python 3.11+. Model availability is client/account-specific.

## Compatibility snapshot

These versions describe observations from 2026-10-02 through 2026-10-04, not a support guarantee
for every release or account. New versions require the live acceptance below.

| Surface | Observed version | Evidence and limit |
| :--- | :--- | :--- |
| Codex Desktop | Earlier proxy: 26.928.20755 / 0.159.0; native adapter: 26.930.21537 / 0.159.0-alpha.12.1 | Native app-server first/follow-up/manual selection passed; notification ordering tested; broad UI/Computer Use/reboot acceptance pending |
| Codex CLI | Native bundled 0.160.0; original npm 0.153.4 retained | Standard interactive/exec/resume passed on 0.160.0; old npm runtime rejected Luna on ChatGPT auth |
| First-party Hermes | Local source at `6f7a7991bb` with native extension | First/follow-up/resume/manual selection passed without proxy inference; refreshed GUI visual acceptance pending |
| Claude Code terminal | 2.1.259 | Experimental Anthropic transport tests; live API generation unverified |
| Claude Desktop Chat/Cowork | No routing integration | Advice-only workflow; no subscription proxy claim |

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
The current adapter gate has 67 JavaScript and 32 Python tests. The pinned
upstream suite has 154 tests. The separate Hermes regression run below is not
part of this repository's credential-free CI gate.
The macOS gate additionally copies the real installed package/dependencies, loads
its CLI and checks generated catalog/startup metadata plus synthetic config restore.
Launchd activation is intercepted; Linux skips this macOS-only check. Use
[clean-install acceptance](CLEAN-INSTALL.md) for the public-checkout runner and
separate login/picker/receipts/reboot steps. Do not infer live success from CI.

## Live acceptance on your account

First run `jev-router doctor` and `jev-router classify-test`. The latter tests
classification only. Its deep architecture prompt previously classified STRONG
at 0.48 confidence; expected labels are test expectations, not forced outcomes.

For opt-in native mode, use [the native setup guide](NATIVE-ROUTING.md), then
test first request, follow-up, cold resume and manual real-model selection. Require
one `native-first-request` receipt, saved native model/provider metadata and no
Jev HTTP inference receipts for that chat. Check model/effort display separately.
`doctor` mainly checks legacy configuration and is not proof of native activation.

For legacy proxy mode, in a fresh normal Desktop chat select Jev and submit a bounded no-tool task.
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

Test the optional Anthropic route only with authorized API authentication through
the original client. Earlier Claude OAuth attempts failed; they are historical
observations, not evidence of permitted or supported subscription routing. A
successful auth status command alone does not prove generation works. See
[authentication scope](CLIENTS.md#claude-code-terminal).

Computer Use, broad compaction/resume, all coding tiers in normal Desktop, family
entries in normal UI and reboot behavior remain separate acceptance checks.
CI is credential-free; passing it is not evidence of these live behaviors.

## Native client acceptance — 2026-10-04

Installed the native Desktop adapter, Hermes extension and terminal launcher on
the development Mac with private code/configuration/launcher backups. These are
dated observations, not clean-Mac or future-client compatibility guarantees.

- **Automated:** 67 JavaScript + 32 Python adapter tests passed. A separate isolated
  Hermes regression gate passed 127 tests across six files: session routing,
  turn context, reasoning overrides, model-switch rollback, plugins and `/new`.
  Installer tests cover ownership conflicts and selective restoration.
- **Desktop/native app-server:** first task selected Luna; follow-up completed
  without reclassification; manual Sol/low completed. Native metadata confirmed
  provider `openai`. Picker replay/notification ordering and cold-resume handling
  are covered by adapter tests. Normal full UI acceptance remains separate.
- **Hermes:** standard launcher first task, resumed follow-up and manual Sol/low
  completed. An old `HERMES_CODEX_BASE_URL` environment override initially kept
  traffic on the proxy; removing that exact owned endpoint corrected transport.
  After correction there was one Hermes classification and zero Hermes proxy
  inference receipts across the probes. Saved metadata retained Luna/high.
- **Terminal:** standard interactive first/follow-up, exec, exec resume and
  interactive cold resume completed using the bundled 0.160.0 runtime. Real
  model/effort remained visible. Exec resume explicitly restored native metadata
  rather than reusing the global Jev alias. Native cached input was observed with
  unchanged effort; this does not establish cache reuse across effort changes.

All new live probes used synthetic tasks and executed no tools. Full tool/approval
UI acceptance, comprehensive compaction, clean-account login startup and reboot
remain untested. Native Codex effort-swap cache behavior is unverified; Hermes
changes request-level effort and does not implement cache-preserving
`configuration_update` items. See [cache limits](NATIVE-ROUTING.md#reasoning-changes-and-caching).
Hermes upgrades can replace the local hook and require revalidation/reapplication.

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
