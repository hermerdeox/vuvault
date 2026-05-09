# M3 Deployment Runbook

Operator-facing checklist for landing the M3 server-side stack
(Cloudflare Pages Function + D1 + R2 + Sigstore-signed releases).
Intended audience: anyone with `wrangler login` + `gh auth login`
and write access to the `vuvault` Cloudflare account and the
GitHub repo.

This document is not a replacement for the design docs in
[ARCHITECTURE.md](./ARCHITECTURE.md) or [SECURITY.md](./SECURITY.md);
it is a concrete sequence of commands to bring the deployment up.

## Prerequisites

- `wrangler` CLI ≥ 4.0 (`npm i -g wrangler` if not local-only).
- A Cloudflare account with Pages + D1 + R2 enabled.
- `gh` CLI authenticated against the `vuvault` GitHub repo.
- A clean checkout of the repo at the tag you intend to release.

## One-time provisioning (per environment)

Each environment (preview, production) gets its own D1 database
and R2 bucket. The `wrangler.toml` defaults are placeholders; the
real `database_id` is created on first provision.

### 1. Create the D1 database

```bash
# Production
wrangler d1 create vuvault-auth-production
# Preview
wrangler d1 create vuvault-auth-preview
```

Each call prints a `database_id`. Paste those into
[wrangler.toml](../wrangler.toml) under the matching
`[[d1_databases]]` (preview default) and
`[[env.production.d1_databases]]` blocks. Commit the change.

### 2. Apply the schema migration

```bash
wrangler d1 migrations apply AUTH_DB --env=production --remote
wrangler d1 migrations apply AUTH_DB --env=preview --remote
```

Migrations live under
[functions/api/_shared/migrations/](../functions/api/_shared/migrations/).
The single `0001_init.sql` creates `accounts`, `pending_registrations`,
`pending_logins`, `sessions`, `device_pairings`, and
`server_identity`.

### 3. Seed the OPAQUE server identity

The OPAQUE server identity (`oprf_seed`, 32 bytes) is generated
once per environment and stored in `server_identity`. Rotating it
invalidates every existing OPAQUE registration — every user has
to re-enroll. Treat it as an append-only secret.

```bash
# Generate the 32 random bytes
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy the output and replace the placeholder in
# functions/api/_shared/migrations/seed_server_identity.sql
# (do NOT commit the real bytes; this file is a template).

wrangler d1 execute AUTH_DB --env=production --remote \
  --file=functions/api/_shared/migrations/seed_server_identity.sql
```

The script will refuse to load the all-zero placeholder. If you
forget to replace the bytes, the deploy will print an explicit
error at `loadServerIdentity()` time.

### 4. Create the R2 bucket

```bash
wrangler r2 bucket create vuvault-blobs-production
wrangler r2 bucket create vuvault-blobs-preview
```

The `bucket_name` strings in [wrangler.toml](../wrangler.toml)
already match these names; no commit needed.

### 5. Configure rate-limiting bindings

Cloudflare's WAF Rate Limiting API is wired in
[wrangler.toml](../wrangler.toml) under `[[unsafe.bindings]]`. The
`namespace_id`s (1001/1002/1003 for preview, 2001/2002/2003 for
production) are placeholder integers; replace each with the actual
namespace IDs the Cloudflare dashboard assigns when you create the
rate-limit rules. Production uses different IDs than preview so a
botched preview deploy can't drain the production budget.

## Per-release checklist

A release is a tagged event (`gh release create vX.Y.Z`). The
release workflow does the heavy lifting; the operator only has to
confirm the inputs.

### 6. Cut the release

```bash
git checkout main
git pull
gh release create v0.2.0 \
  --title "VuVault 0.2.0" \
  --generate-notes
```

This triggers [.github/workflows/release.yml](../.github/workflows/release.yml).
The workflow:

1. Builds twice with `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD)`
   to produce a deterministic `.bundle-digest`.
2. Signs `.bundle-digest` keylessly via cosign + Sigstore Fulcio,
   producing `.bundle-digest.sig` + `.bundle-digest.pem` and
   publishing the Rekor entry.
3. Verifies the signature locally before deploying.
4. Bundles `bundle-manifest.json` + signature + cert + Rekor URL
   into a tarball attached to the GitHub Release.
5. Deploys to Cloudflare Pages with `PUBLIC_BUNDLE_HASH` set to
   the just-signed digest, `PUBLIC_VAULT_VERSION` set to the tag.

### 7. Verify the running build

After the workflow finishes:

```bash
# Fetch the live HTML
curl -s https://vault.vu | grep -oE 'PUBLIC_BUNDLE_HASH[^"]+' | head -1
# Should match the value the release workflow signed.

# Look up the Rekor entry
RELEASE=$(gh release view v0.2.0 --json assets -q '.assets[0].url')
# RELEASE.txt in the release artifacts has the search URL.
```

The unlock screen at <https://vault.vu/unlock> should now display
the green `(verified)` badge instead of `(dev build · no published
hash to verify)`.

### 8. Required CI secrets

The release workflow needs three secrets configured at the repo or
org level:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Pages deploy + D1/R2 write |
| `CLOUDFLARE_ACCOUNT_ID` | Identifies the target account |

Cosign keyless signing uses the GitHub-issued OIDC token; no
long-lived signing key is required. The
`permissions: id-token: write` block in `release.yml` is what
unlocks that.

## Rollback

Cloudflare Pages keeps every deploy. To roll back:

```bash
wrangler pages deployment list --project-name=vuvault
wrangler pages deployment rollback <previous-id>
```

D1 schema changes are forward-only. There is no automatic schema
rollback — if migration `0002_*.sql` introduces a breaking change,
the rollback story is "deploy the previous Worker code and tolerate
the extra columns/tables", or "drop and re-migrate" if the change
is destructive enough that mixed-version reads break.

## Operational invariants

These are the runtime invariants every M3 deploy MUST preserve:

1. **`PUBLIC_BUNDLE_HASH` MUST equal the manifest aggregate of the
   bytes Cloudflare actually serves.** The two-pass build CI step
   asserts this on every PR. The reproducible-build job asserts
   that two independent builds of the same SHA produce byte-
   identical aggregates.
2. **The OPAQUE server NEVER stores plaintext passwords.** The
   schema only has `client_public_key`, `masking_key`,
   `envelope_bytes`, `oprf_secret_key` — none of which let the
   server recover a password offline.
3. **Demo-mode auth is gated by `isDemoAuthEnabled()` AND the
   server-side `authMode === 'production'` guard.** Production
   deploys leave `PUBLIC_ENABLE_DEMO_AUTH` unset / false, and the
   CI marketing-claim and demo-auth guards prevent regressions.
4. **The session token is bearer-only and `sessionStorage`-scoped.**
   No persistent token lives on disk — locking a tab kills sync
   capability until the next OPAQUE login.
5. **Sync failure is non-fatal.** Every sync method returns
   `{ ok: false, reason }` rather than throwing; the caller stays
   on the local-only path on failure. The
   `vault-session.test.ts > sync fallback` block proves this.

## Follow-ups deferred to future tiers

- **R2 GC of old blob versions** — currently retained indefinitely.
  The Cron Trigger Worker that prunes to the latest 8 versions is
  a follow-up PR.
- **MLS sharing (L06)** — group encryption with forward secrecy is
  a Tier-2 follow-up, separately tracked.
- **CONIKS / AKD transparency log (L09)** — Tier-3 (2028); requires
  a separate verifiable log infrastructure beyond Sigstore.
- **FROST recovery (L11)** — Tier-3 (2028); coordinates threshold
  signatures across paired devices.
