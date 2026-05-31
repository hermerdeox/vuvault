# `migrations/proposed/` — staged but not-yet-applied schema changes

Migration files in this subdirectory are **drafts** that have been written
and reviewed but are deliberately **not in the `wrangler d1 migrations
apply` chain**.

`wrangler d1 migrations apply` walks only the top level of the configured
`migrations_dir` (`migrations/` per [`wrangler.toml`](../../wrangler.toml))
and matches files against the `NNNN_*.sql` pattern. **Subdirectories are
skipped**, so files placed here cannot be picked up by accident.

## When is a migration draft placed here?

When a schema change is designed and reviewed ahead of the application-
layer changes it must coordinate with — typically because the brief's
spec-first discipline requires the design pass to land before any code.
The migration sits here in `proposed/` until:

1. The corresponding maintainer sign-off lands (Appendix B-style decision).
2. The same PR that moves this file up one directory (`mv migrations/proposed/NNNN_*.sql migrations/NNNN_*.sql`) also lands the application-layer changes that the migration coordinates with.
3. CI on that PR runs `wrangler d1 migrations apply --local` and asserts the new schema; the `release.yml` workflow then applies it to production via `wrangler d1 migrations apply AUTH_DB --env production --remote`.

## Current contents

- [`0004_metadata_minimization.sql`](./0004_metadata_minimization.sql) — closes [`VU-LEVEL-MIGRATION-MAP.md`](../../docs/VU-LEVEL-MIGRATION-MAP.md) V1-C2 (no persistent device set). Drafted 2026-05-22. Awaits Appendix B.2 sign-off per the Vu1 migration brief. Coordinates with the §L08 session-mint redesign sub-section in [`docs/TIER2-ARCHITECTURE.md`](../../docs/TIER2-ARCHITECTURE.md).

## Why not just keep it on a branch?

Two reasons:

- The audit trail is clearer when the design artifact lives on `main` alongside the design notes that justify it. Reviewers can see exactly what schema is being proposed without juggling branch refs.
- The file header carries the "AWAITING SIGN-OFF" marker and links to the deliverables that must land alongside it; that's harder to surface in a one-line PR description on a long-lived branch.

## Discipline

- Never edit a file in `proposed/` once it has been moved up (and applied). At that point it is a shipped migration; treat it the same as `0001_init.sql` and friends — never edit a shipped migration; add a new one.
- A migration in `proposed/` may be revised based on review feedback. Each revision should bump a comment like `-- revision N: <date> — <reason>` in the file header, NOT a new numbered file. The number is the slot it will occupy in the apply chain.
- When the brief governing this draft is updated, this README's "Current contents" list MUST be updated in the same PR.
