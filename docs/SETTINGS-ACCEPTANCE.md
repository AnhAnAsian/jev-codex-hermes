# Settings browser acceptance

Run against an isolated service/configuration with a simulated classifier. Never
use real keys or live client settings for failure injection. The service accepts
injected configuration, catalog, classifier and SettingsStore dependencies; the
HTTP regression fixtures in `test/settings.test.mjs` demonstrate this setup.

These browser scenarios complement the automated unit/HTTP gate. They were run
in the Codex in-app browser at desktop width and 390 × 844 during the settings
update. Screenshots use synthetic settings, and the README preview is one capture.

1. **Profile editing and save.** Change mixed-profile FAST reasoning, switch to
   Sol, change its FAST reasoning, then switch back. Both drafts persist and the
   change bar names both profiles. Save: both changes persist, one private backup
   is created and the idle bar disappears. Edit again: the old Saved notice clears.
2. **Global scope and recovery.** Open Advanced and disable FAST. Switch profiles:
   FAST is disabled with “Off in all profiles.” Discard restores it. Make another
   edit, change the configuration externally, and save: the conflict preserves
   the draft and tells you to reload. Discard/reload picks up the external state.
3. **Mode-aware timing.** Test proxy-only, native Desktop-only, native Desktop
   plus native clients, disabled clients and malformed native-client metadata.
   The selector names only applicable proxy clients. Native Codex shows its fixed
   behavior; native Hermes labels the remaining control Hermes · Claude. Save an
   unrelated field and verify hidden Codex timing is unchanged on disk.
4. **Privacy and health.** Save a nondefault character limit and open Ask Jev:
   its notice uses that value. Change limit/provider externally, then Ask: the
   notice updates and no classification occurs until a second click. Break the
   configuration and Check again: both pages show Needs attention and last-valid
   recovery guidance. Restore it and check again: Ready returns.
5. **Responsive and keyboard use.** At 390 × 844 verify no horizontal overflow,
   visible field labels and no idle save overlay. The changed-state Save/Discard
   buttons remain reachable. Tab through controls; expand Advanced and Fallback
   with the keyboard. Invalid fields in a closed disclosure must open that section
   for correction. Custom models and unknown saved IDs remain editable.

The backend gate separately injects catalog refresh failure after a save and
asserts HTTP 200 with saved state plus a refresh warning. It also checks stale
revisions, private-field preservation, effective disclosure, mode metadata, and
catalog cache invalidation. These tests do not require live provider accounts.

The catalog microbenchmark measured median read cost of about 0.74 ms before
caching and 0.002 ms for unchanged cached reads (1,000 samples on one local Mac).
This is read/parse cost, not a chat latency or provider-throughput claim.
