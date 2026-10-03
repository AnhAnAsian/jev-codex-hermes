# Settings

Open `jev-router settings` or `http://127.0.0.1:48767/settings`. Use your configured
port if it differs. Settings are a plain static page served by the existing local
service; no additional gateway, server or frontend build is required.

## Controls

- Enabled: pauses automatic classification without removing client integrations.
  Virtual Jev selections use the configured fallback; real manual selections pass through.
- Routing: conversation mode pins the first choice; turn mode classifies each new
  human turn, while tool loops remain pinned. Mode changes apply on the next request.
- Tiers: provider-specific models/efforts with shared global tier toggles.
- Fallback: used when classification is unavailable, or routing is paused.
- Classification limit: 256–30,000 task characters; default 8,000.

Saved model/effort mappings apply to new chats. Existing pinned chats keep their
choice until an explicit override or service restart. After model ID changes, run
`jev-router refresh-catalog` and restart Desktop to update advertised context
limits. Model IDs must exist on your account; accepting a syntactically valid ID
is not proof of provider availability. Codex suggestions come from its local
catalog. Claude discovery is unavailable. Capability normalization may clamp an
unsupported effort to a supported level; inspect outbound receipts.

Each save validates the full merged config before writing. A timestamped private
backup of the original config is created under `~/.config/jev-router/backups/`;
replacement is atomic with owner-only permissions. An optimistic revision check
rejects stale browser edits. Reload to pick up external edits, then reapply.
External editors should still avoid saving at the exact same moment as the UI;
there is no cross-process filesystem lock.

## Advanced configuration

The authoritative file remains `~/.config/jev-router/config.json`. The page only
changes a bounded projection; classifier configuration, client flags, family
variants, endpoints, port, Desktop mode and unknown extension fields are preserved.
Do not paste API keys into that file or into browser fields.

To switch classification backend, first back up config.json and set `classifier`
to `{"provider":"typesafe"}` or `{"provider":"openrouter","model":"jev-1.13"}`.
Then use `jev-router key` or `jev-router key --openrouter` privately in a terminal.
The hidden key command selects its backend and restarts the service. It clears
conversation pins. Key values and upstream URLs are excluded from settings responses.

Family-only mappings remain under `variants.codex.luna` / `variants.codex.sol`.
Client integration changes require the documented disable/enable procedure;
changing only a client flag does not restore its configuration.

## Request protection

The listener accepts only loopback connections and expected localhost Host values.
Browser saves require exact same-origin, JSON content type and a process-specific
anti-CSRF token obtained from the settings response. Other origins cannot read the
response through CORS. Payloads are bounded to 32 KiB; arbitrary configuration
fields are rejected. Scripts/assets use a restrictive CSP and no remote resources.
This protects against websites making background writes; it is not an authentication
boundary against other local processes or untrusted extensions under your account.
