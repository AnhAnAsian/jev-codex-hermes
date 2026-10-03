# Public-release preparation

[README](../README.md) · [Security policy](../SECURITY.md) · [Client scope](CLIENTS.md) · [Validation](VALIDATION.md)

Publication is a separate, explicit maintainer action. This checklist and the
security helper do not change repository visibility. Public code, history and
Actions logs can be copied; making the repo private again cannot retract copies.

## Release checks

1. **Verify commit privacy.** Use a GitHub noreply address for this repo's future
   commits. Inspect author/committer identities across all publishable refs, not
   just the last commit. Review PR refs, cached old commit views, screenshots and
   previous Actions logs. Keep recovery bundles and original email mappings
   outside every Git repository with owner-only permissions.
2. **Keep authentication claims accurate.** The verified development scope is
   Codex Desktop and first-party Hermes on Codex OAuth. Anthropic routes are
   experimental API-auth integrations; consumer subscription credential routing
   is not supported or promised. Transport success is not policy approval.
3. **Run the gates.** Run `npm run validate`, `npm test --prefix upstream`, and the
   Secret scan workflow. Review dependency alerts and test evidence. No paid keys,
   private prompts or original client credentials belong in CI or scan artifacts.
4. **State limits and costs.** Publish the tested client-version snapshot and
   remaining live acceptance gaps. Classification sends bounded task text to
   TypeSafe/Jev, directly or through OpenRouter, and costs paid classifier usage.
   Original inference quotas/billing still apply. No cache or quota-saving promise.
5. **Activate reporting after publication.** After an explicitly approved change
   to public, run the helper below. Verify every reported feature and the private
   reporting form before announcing the release. Retain experimental labeling,
   independent-project attribution and upstream/dependency license notices.

## GitHub security activation

Use an authenticated `gh` CLI with repository admin access:

```sh
python3 scripts/github-security.py
python3 scripts/github-security.py --apply
```

The first command checks only. The second enables free public-repository secret
scanning, push protection and private vulnerability reporting, then verifies them.
It never changes visibility or enables paid Advanced Security. It refuses to
apply while the repo is private and reports `pending-publication` with exit 2.
Any incomplete verification is also nonzero; don't treat attempted writes as success.

Private reporting URL:
<https://github.com/AnhAnAsian/jev-codex-hermes/security/advisories/new>

While private, authorized collaborators may use the private issue tracker. After
publication, sensitive reports belong only in the enabled private reporting form,
not public issues. See [SECURITY.md](../SECURITY.md) for reporting contents.

## History rewrite and other Macs

Changing `git config user.email` affects future commits only. A history rewrite
changes commit IDs and invalidates old signatures. Verify identical historical
file trees and keep a private bundle before replacing branches. Use explicit
leases and atomic updates so a concurrent push cannot be overwritten.

Rewriting branches does not guarantee removal of read-only PR refs or cached old
commit views. GitHub Support controls server-side cleanup and does not promise
removal of non-sensitive data. Do not claim complete erasure based on a clean
local `git log`. See [GitHub's removal limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#about-sensitive-data-exposure).

After a rewrite, keep the old checkout private for recovery. On the other Mac,
clone the cleaned repository into a separate directory and set that repo's commit
email to the noreply address from [GitHub email settings](https://github.com/settings/emails).
Preserve any local work; do not merge the old history into the new one. Pulling
the repository or recloning does not update the installed router or its settings.

If old server-side views still contain information that must not become public,
leave this repository private. A clean public repository without those existing
views requires a separate authorized release decision, not merely a force-push.

## Continuous secret scanning

`.github/workflows/secrets.yml` scans full fetched history on push, pull request
and manual dispatch. Gitleaks 8.30.1 is downloaded from its official release and
checked against a committed SHA-256 before execution. Workflow permissions are
read-only; checkout credentials are not persisted, scan output is fully redacted,
and no reports containing matches are uploaded as artifacts.

Update the tool version and checksum together after reviewing the upstream
release. Do not add blanket allowlists to suppress findings. Secret scanning
doesn't detect every personal-data disclosure or establish absence of bugs.
