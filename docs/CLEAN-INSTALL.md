# Clean-install acceptance

Two checks answer different questions. The public-checkout gate proves the source
and installed package can load with synthetic configuration. The live check proves
your actual clients, account and macOS startup work. Do not mark one as the other.

## Fresh public checkout — about 3–5 minutes

From a checkout, with Node 22+, Git and Python 3.11+:

```sh
python3 scripts/check-public-checkout.py --ref main --report /tmp/jev-checkout-report.json
```

Use a new report filename for each run. The script clones the public repository
anonymously into a temporary directory, installs locked dependencies, bootstraps
the pinned upstream and runs both gates. It reports the exact commit, runtime
versions, stage results and explicit **NOT RUN** live checks. It neither registers
a service nor modifies your client configuration; no classifier key is needed.
It prints no raw subprocess output and removes the temporary checkout afterward.
Failures identify the stage: reproduce that stage in a disposable checkout to
inspect output locally, and redact it before sharing.

On macOS, the package test copies the real release files and dependencies, loads
the copied CLI, generates the startup plist and installs/restores synthetic
Codex/Hermes configuration. Launchctl/process activation is intercepted. Linux
skips this macOS packaging test. Plist generation is not proof of login startup.
The **Public checkout smoke** Actions workflow runs the same check on demand.

## Live clean Mac check — about 20–30 minutes, plus reboot

Use a separate macOS account or another Mac with no existing Jev installation.
**Do not simulate a clean machine by changing HOME in your everyday account:**
the fixed launchd label could collide with its running router. For an existing
installation, use [migration and recovery](OPERATIONS.md) instead.

1. **Baseline and login — 5 minutes.** Set up Codex Desktop and first-party Hermes
   normally. Sign in through their own UI/CLI; make a bounded ordinary request in
   each. Open the Codex model picker to populate its catalog. Configure Hermes's
   existing `openai-codex` subscription provider. Record client/OS/Node/Python
   versions and the adapter ref. Keep client configs and OAuth files private.
2. **Install from public source — 5 minutes.** Clone the URL below and run the gate
   and installer. Omit `--hermes` only if recording Codex-only acceptance. Enter the
   classifier key through the hidden terminal prompt; never paste it in an issue.
   Classification sends task text externally and costs classifier credits.
3. **Picker and real routing — 5–10 minutes.** Restart clients. In normal Desktop,
   select **Jev** and ask “Calculate 2 + 2. Do not use tools.” Repeat in Hermes
   after `/model jev`, and search its picker for `jev`. Inspect receipts privately
   with `jev-router logs --follow`: require an actual `served_model`, not merely
   a classifier result. Record selected tier/model and outbound effort separately
   from provider-confirmed effort; use **unverified** when unavailable. Send a
   follow-up and check `conversation-pinned`. Repeat Jev Luna/Sol to verify family
   constraints. `classify-test` covers four synthetic tiers but does not prove
   real client generation; LONG is an expectation, not a forced classifier label.
4. **Normal login startup — 3–5 minutes plus reboot.** Reboot or log out/in. Launch
   normal Desktop/Hermes without running a start command. `jev-router status`
   must report a running listener and a new bounded request must produce a receipt.
   Check the listener with the command below: the configured port must listen
   only on `127.0.0.1`. Account login must still be owned by the original clients.
   Sign-in status alone does not prove generation; repeat the request after startup.
5. **Disable and restore — 3–5 minutes.** Run `jev-router disable`, restart clients
   and make a normal direct request. Confirm original provider/model settings and
   unrelated tools/MCP/hooks are preserved using the private pre-install backups.
   Re-enable and restart clients if keeping the test installation. For removal,
   follow [uninstall](OPERATIONS.md#disable-and-uninstall); retain recovery backups
   until direct client operation is confirmed.

Install commands for step 2:

```sh
git clone https://github.com/AnhAnAsian/jev-codex-hermes.git
cd jev-codex-hermes
git rev-parse HEAD
npm ci --ignore-scripts
npm run bootstrap
npm run validate
npm test --prefix upstream
python3 scripts/install.py --hermes
~/.local/bin/jev-router key --openrouter
~/.local/bin/jev-router doctor
~/.local/bin/jev-router classify-test
```

Listener check for step 4 (adjust if you chose another port):

```sh
lsof -nP -iTCP:48767 -sTCP:LISTEN
```

Claude Code / Hermes Anthropic require separate experimental acceptance with
authorized API authentication; a Codex subscription pass does not cover them.
Computer Use, permissions, resume and compaction need their own representative
client tasks before making broader compatibility claims.

## Record the result

Keep detailed evidence private. A public summary may use this template:

```text
Date / adapter commit / OS / Node / Python:
Client versions / answering provider / classifier provider:
Public-checkout gate: PASS / FAIL / NOT RUN
Codex Desktop: login / picker / served model / follow-up pin / startup / disable
Hermes: login / picker / served model / follow-up pin / startup / disable
Reasoning: outbound …; provider-confirmed … or UNVERIFIED
Routing profiles: mixed …; Luna …; Sol …
Not tested / remaining limitation:
```

For each live item use PASS, FAIL or NOT RUN. Share only routing metadata, never
private prompts, keys, OAuth headers, source code, client configs or raw dumps.
Attach the automated metadata report only after checking it for personal data.
