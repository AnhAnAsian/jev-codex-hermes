# Privacy and security

The listener binds to IPv4 `127.0.0.1` only. Browser origin checks reject remote
origins. Local processes can still access the service; localhost is not a user
authentication boundary. Do not expose it through port forwarding or a LAN bind.

Provider destinations require HTTPS in normal configuration. Auth/account headers
are forwarded transiently in memory. The service does not open Codex/Claude OAuth
credential stores or persist tokens. The original client remains responsible for
login/refresh. Client config backups can contain pre-existing credentials and
remain in owner-only local state; never upload them.

Classification sends bounded task text to TypeSafe/Jev, optionally through
OpenRouter. It is not an offline classifier. Prompts may include sensitive text;
use regular client models or disable routing when external classification is
inappropriate. Key files belong outside source control. Default routing logs
contain only an allowlist of metadata, including hashed conversation IDs.
Upstream debug/request dump switches are suppressed by the adapter.

No live secrets are used in CI. Synthetic test headers are placeholders.
The package check is heuristic and does not replace review or a full secret scan.
Dependencies and client wire formats can change. Audit changes and re-run live
acceptance checks when upgrading. No model safety or permission behavior is
guaranteed merely by the proxy forwarding a request successfully.

## Report a vulnerability

For the public project, use **[GitHub's private security reporting form](https://github.com/AnhAnAsian/jev-codex-hermes/security/advisories/new)**.
This is the intended confidential route, not a public issue. The maintainer must
enable private vulnerability reporting when the repository becomes public; the
form's availability is verified by `scripts/github-security.py`. If the form is
unavailable, do not put exploit details or sensitive data into a public issue.
An ordinary issue may report only that the confidential reporting form is missing.

While the repository is private, existing authorized collaborators can use its
[private issue tracker](https://github.com/AnhAnAsian/jev-codex-hermes/issues/new).
That is not a reporting route for outside users and must not be used for sensitive
reports after publication.

Include the affected adapter/client versions, relevant route, expected/actual
behavior and a minimal reproduction using synthetic credentials and task text.
Never include live tokens, API keys, raw request dumps, private source or backups.
There is no guaranteed response time or bug bounty; this is an independently
maintained experimental project.

## Continuous checks

The Secret scan workflow runs on pushes, pull requests and manual dispatch. It
scans full fetched Git history with a checksum-pinned Gitleaks CLI, read-only
repository permissions and fully redacted output. It uses no paid scanning action,
account keys or uploaded scan artifacts. It complements the package check and
does not prove that all secrets or vulnerabilities are absent.

After publication, run `python3 scripts/github-security.py --apply` to enable and
verify GitHub private vulnerability reporting, secret scanning and push protection.
The helper refuses to apply changes while private and never changes visibility
or enables paid Advanced Security. See [release preparation](docs/PUBLIC-RELEASE.md).

## Provider authentication scope

Codex/Hermes Codex routing has live observations; this is not provider endorsement.
Optional Anthropic routes are experimental API-auth integrations. Consumer
subscription credential routing is not supported or promised. See the
[client guide](docs/CLIENTS.md) and the linked provider policy before opting in.

## Local settings writes

The settings page exposes only an editable projection, never keys or upstream URLs.
Saves require a process-specific token, exact same-origin and JSON content type;
unknown fields, invalid values, oversized payloads and stale revisions are rejected.
The existing loopback/Host checks and restrictive CSP also apply. Private backups
precede atomic replacement. Local account processes are inside the trust boundary.
