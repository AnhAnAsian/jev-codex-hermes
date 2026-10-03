# Contributing

Keep this adapter small. Reuse upstream Jev classification and decision policy;
put client-specific behavior in the adapter. Changes should make normal client
operation easier to verify and recover.

## Run the gate

Node 22+, Python 3.11+ and Git are required. Work in the repository checkout:

```sh
npm ci --ignore-scripts
npm run bootstrap
npm run validate
npm test --prefix upstream
```

Tests use synthetic requests, temporary homes and fake credentials. They do not
require paid classifier access or client logins. Passing them does not prove live
Desktop behavior; use [VALIDATION.md](docs/VALIDATION.md) for client acceptance.
Do not run the installer against your everyday configuration merely to test code.

## Find the code

| Area | Files |
| :--- | :--- |
| Transport and classification | `src/service.mjs`, `src/classifier-client.mjs`, `src/routing.mjs` |
| Settings and browser UI | `src/settings*.mjs`, `ui/` |
| Client config and recovery | `manage.py`, `desktop.py`, `hermes_picker.py` |
| Packaging and commands | `scripts/`, `cli.mjs`, `upstream.lock.json` |
| Regression coverage | `test/`; unchanged upstream tests in the bootstrapped checkout |

## Change safely

1. Describe the client, trigger and expected behavior; distinguish mock coverage from live evidence.
2. Preserve unknown settings and user edits. Back up before client writes; restore only fields the adapter owns.
3. Add meaningful regression coverage for routing, auth forwarding or config restoration changes.
4. Run the gate and update the relevant client/settings/operations guide when behavior changes.
5. Review the diff for secrets and personal data before pushing; keep live receipts and backups outside Git.

Never commit task payloads, source snippets from private projects, tokens, keys,
client configs, `.env` files or debug request dumps. Send security findings through
a private channel as described in [SECURITY.md](SECURITY.md).

Upstream is pinned and unmodified. If an upstream change is needed, explain why
the adapter cannot handle it, update the lock deliberately and rerun both suites.
No blanket dependency updates or new gateway framework are needed for docs/UI polish.
