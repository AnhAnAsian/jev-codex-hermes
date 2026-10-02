# Operations and recovery

Installed code: `~/.local/share/jev-router/`. Private state:
`~/.config/jev-router/`. The user LaunchAgent is
`~/Library/LaunchAgents/ai.typesafe.jev-router.local.plist`.
Backups are timestamped before configuration writes. `integration.json` and
`desktop-picker.json` record owned fields for selective restoration.

The installer defaults to Codex Desktop; Hermes and Claude require explicit
flags. Hermes stays on its existing provider. Codex uses a custom Responses
provider with `requires_openai_auth=true` and a local model catalog. No client
binary is patched. A hook is installed only in the optional `hook-subagent`
fallback mode; true picker routing does not require a new hook.

## Disable and uninstall

Use `jev-router disable`, then restart clients to restore direct operation.
Use `desktop-disable` plus Desktop restart to disable only Desktop. The stop
command restores clients before stopping the listener. A crash/unmanaged stop
can interrupt a client still pointed at the proxy; fail-open classification
does not mean an absent proxy can forward requests.

`jev-router uninstall` restores owned fields, unloads startup and removes owned
command shims. It retains installed code and private backups for recovery.
After confirming normal clients work, delete `~/.local/share/jev-router/` and
`~/.config/jev-router/` to remove all remaining code, keys, logs and backups.
Deletion of those backups is permanent; retain them until recovery is complete.

Restoration preserves user-modified fields and reports conflicts. Do not
overwrite whole client config files or blindly copy a backup over new settings.
Changing the listener port requires regenerating client integrations; disable,
edit the port, restart the service, then enable and restart clients.

## Existing installation / adapter migration

The initial installer refuses to replace existing code or state. The original
development setup remains installed independently of this repository.

To migrate intentionally: validate the new checkout first, record current
mappings, use the old installation's disable/stop commands, and make private
copies of code and state. Stage the new code beside the old copy rather than
merging directories blindly. Preserve the unchanged upstream checkout or run
bootstrap for the release lock. Verify dependencies, then replace code and
regenerate startup registration with `python3 manage.py install-service`.
Use the matching CLI to enable and repeat live acceptance. Keep the previous
copy for rollback. A zero-downtime adapter upgrade is not implemented.

## Upstream updates

The legacy `jev-router update` fast-forwards an installed upstream Git checkout,
installs locked dependencies, runs upstream/adapter suites and restarts only
after success. It rolls back the upstream revision when checks fail. This is
an opt-in moving update; it does not rewrite the release lock or update this
adapter. Prefer deliberate release changes for reproducible deployments.

Conversation pins do not survive restarts. Do not treat an unchanged Jev picker
label as a persistent backend-model guarantee after updating/rebooting.
