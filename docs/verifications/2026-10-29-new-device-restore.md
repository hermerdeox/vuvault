# New-device restore — verification report

**Date:** 2026-10-29
**Scope:** closing the "device loss = vault loss" gap: a device with only
the Secret Key + Recovery Password restores its vault from the sync
server and binds it to a new passkey, without introducing a stable
per-account server address (V0-C1 preserved).
**Authority:** [`docs/PRIVACY-LEVEL.md`](../PRIVACY-LEVEL.md) (2026-10-29
note), [`docs/VU-LEVEL-MIGRATION-MAP.md`](../VU-LEVEL-MIGRATION-MAP.md)
§V0-C1.

## TL;DR

Before this pass the only recovery paths needed the local IndexedDB
rows: `openVaultWithRecoveryEnvelope` threw "No account found" on a
fresh device, the onboarding "Restore from another device" button was a
dead `#restore` anchor, and the server copy was reaped after 60 days of
inactivity. The inventory address chain, the blob AAD, and the OPAQUE
client id were all derived from device-bound material, so a fresh
device could not even locate the copy.

This pass ships the restore end to end and proves it behaviourally in
a real browser against the wrangler-backed D1/R2 API.

## What changed

| Layer | Change |
| --- | --- |
| Crypto | [`src/lib/crypto/restore-record.ts`](../../src/lib/crypto/restore-record.ts) — sealed 2 KiB restore record; address `HKDF(root, day ‖ slot)`; root wrapped locally under the vault data key. [`recovery-envelope.ts`](../../src/lib/crypto/recovery-envelope.ts) `deriveRecoveryMaterial` — one Argon2id stretch yields the envelope key and the restore root; deterministic salt from the Secret Key. |
| Chain | [`blob-inventory.ts`](../../src/lib/services/blob-inventory.ts) `deriveChainKey` — inventory chain re-rooted on data key + device salt, so MP / OPAQUE rotations keep it and a restoring device can walk it. |
| Session | [`vault-session.ts`](../../src/lib/services/vault-session.ts) — `writeRestoreRecord` (first push per UTC day, then per 64 saves, forced on rebind / install; fresh (day, slot) reserved before upload), `installRestoreRoot` / `disableServerRestore` (purge old records on rotation / disable), `adoptRestoredVault` (walk → fetch → decrypt → re-seal on this device). |
| Service | [`recovery-envelope.ts`](../../src/lib/services/recovery-envelope.ts) `enableRecovery` (envelope + restore root from one stretch), [`server-restore.ts`](../../src/lib/services/server-restore.ts) `discoverRestoreRecord` (scan today → −62 days, ≤ 8 slots/day). |
| Server | [`/api/v2/restore/[addr]`](../../src/routes/api/v2/restore/[addr]/+server.ts) — PUT/DELETE token-gated; GET credential-free, IP-rate-limited (`RESTORE_READ`), 404 on miss. [`migrations/0011_restore_references.sql`](../../migrations/0011_restore_references.sql) + GC sweep in [`r2-gc.ts`](../../src/lib/server/api/r2-gc.ts). |
| UI | [`/restore`](../../src/routes/restore/+page.svelte) (two phases: find + log in, then bind passkey + adopt; demo fallback when allowed); StepWelcome link; `/recover` "Restore from sync" option and fresh-start copy; Security settings status + hint; Emergency Kit text. |

## Verification

| Gate | Result |
| --- | --- |
| `npm run check` | 0 errors, 105 pre-existing warnings |
| `npm run lint` | 0 errors |
| `npx vitest run` | 52 files, 498 tests passing (23 new: `restore-record.test.ts` 8, `v2-restore.spec.ts` 8, `server-restore.spec.ts` 6, `r2-gc.test.ts` +1) |
| `node scripts/audit-bindings.mjs` / `.test.mjs` | OK (Rule 4 clean with migration 0011) |
| `node scripts/verify-pins.mjs` | OK |
| M3 e2e (`sync.spec.ts` + `pwa.spec.ts`, wrangler on 8788, `M3_E2E=1`) | 8/8 — includes **restore onto a fresh device with only Secret Key + Recovery Password** (8.3 s) |
| Smoke e2e (landing, vault-flows, privacy-level, mobile, full-workflow) | 46/46 |

### What the restore scenario proves (tests/e2e/sync.spec.ts)

1. Onboard (real OPAQUE registration + login against local D1), save an
   item, sync.
2. Wipe IndexedDB, session, and passkey (`clearStorage`).
3. `/restore` with the Secret Key + Recovery Password + a device label:
   Argon2id stretch → record found → OPAQUE login with the client id
   from the record → passkey registered (PRF shim) → vault adopted.
4. The item is visible in `/vault`; the restore GETs carried no
   credential; every blob/inventory request still spent its own
   anonymous token; no legacy route was touched.
5. Lock, then unlock with the **new** device's quick-unlock passkey.

### What the integration suite proves (tests/integration/server-restore.spec.ts)

- The install publishes exactly one record (fixed 2 KiB + tag); two
  further saves the same day add none; the walk from the record's
  index reaches the newest save.
- The restored device's own record lands at the next slot of the day
  the record was found at — the old device's address is never
  rewritten.
- A wrong Recovery Password finds nothing; restore refuses to run over
  an existing vault.
- A master-password rotation keeps the chain position and the restore
  state (no restart at 0); a later restore still works.
- Rotating the Recovery Password DELETEs this device's old records and
  re-keys (old password finds nothing, new one does); re-affirming the
  same password is `unchanged`; disabling recovery deletes everything.
- Cadence: 64 saves after the record trigger exactly one more, at a
  fresh address.

## Privacy accounting

- **No stable address.** Every record address is fresh per (UTC day,
  slot) and never rewritten; without the root, addresses are
  unrelated-looking strings — the same discipline as the inventory
  chain. The record address needs the Recovery Password, so the Secret
  Key alone cannot fetch the ciphertext.
- **Credential-free read.** Deliberate: no session exists before the
  record is opened. The 128-bit address is the capability (as the UUID
  is for blobs); abuse is bounded per IP; confidentiality by the
  record's AES-256-GCM seal under a key the server cannot derive.
- **Residuals (unchanged in kind):** a restore read links the restoring
  session to the writing session (as "Sync now" already does); Secret
  Key + Recovery Password restore without the passkey (the local
  Recovery Envelope's threat model — this record is its server-held
  twin); two devices active on the same day can collide on a slot
  (last writer wins) — concurrent multi-device stays Tier 2; a master
  password does not carry over, as with a passkey rebind.

## Operational notes

- Migration `0011_restore_references.sql` must be applied before the
  route is deployed; the release workflow's `wrangler d1 migrations
  apply --env production --remote` step covers it. If the route ran
  ahead of the migration, records would still store and serve, but
  never be GC'd.
- Existing accounts have no restore root until the user re-enters the
  Recovery Password once (Security settings → "Rotate recovery"); the
  settings panel says so. New accounts get it at onboarding when sync
  is wired and OPAQUE enrolment succeeded.
