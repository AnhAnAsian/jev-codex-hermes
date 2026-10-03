# Dependency updates: one PR at a time

Dependabot opens separate monthly npm and GitHub Actions updates, with at most
three open PRs per ecosystem. Updates are not grouped. Repository auto-merge is
disabled; no workflow automatically approves or merges them. Major updates stay
open until their breaking changes and required validation have been reviewed.

## Review gate

1. Inspect the exact diff and official release notes. For an Action, verify its
   full commit SHA belongs to the claimed official release. Check runner/Node
   requirements and changed defaults; for npm, inspect the lockfile and scripts.
2. Run adapter and unchanged upstream tests. Require passing macOS/Linux CI and
   the full-history secret scan on the current PR head. Changed commits invalidate
   earlier approval; do not bypass failed checks or merge several updates together.
3. Match testing to impact. Transport/auth/routing changes also need the relevant
   [live acceptance](CLEAN-INSTALL.md). CI tooling changes need both CI platforms.
   Record what was actually tested and what remains unverified in the PR review.
4. Merge only the reviewed head, then confirm main CI passes before reviewing
   the next update. A major version number alone neither proves safety nor makes
   an update unusable. If required evidence is missing, leave the PR unmerged.
5. Keep releases reproducible: do not move published tags or silently update the
   separately pinned upstream. Updating GitHub Actions does not require restarting
   an installed router; runtime changes use the documented migration procedure.

Example after review, with the current full head SHA:

```sh
gh pr checks NUMBER --required
gh pr merge NUMBER --merge --match-head-commit REVIEWED_HEAD_SHA
```

An empty required-check list is not a pass: inspect all macOS/Linux validation
and secret-scan results even when the repository has no required-check rule.

## Initial review record — 2026-10-03

PRs #1–#3 updated setup-python to 7.0.0, setup-node to 7.0.0 and checkout to
7.0.1. Each official release SHA and runner compatibility was reviewed separately.
The combined main commit `63d583fbed767321c3aa4d5582db77cf07617d9f` passed macOS,
Linux and secret-scan CI. These changes affected CI only. They did not validate a
new client build or change the running installation.
