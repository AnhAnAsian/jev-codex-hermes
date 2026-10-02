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

For private reports, contact the repository owner through a private channel;
do not post credentials, task payloads or request dumps in issues.
