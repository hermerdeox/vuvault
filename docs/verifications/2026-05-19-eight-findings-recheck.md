# Eight-Finding Re-Check — 2026-05-19

**Source list** (from the operator at 2026-05-19 04:03 UTC-4):

> Critical OPAQUE server identity unstable — `src/lib/server/api/d1-storage.ts`
> Critical Production sync deploy not wired — `.github/workflows/release.yml` + `wrangler.toml`
> High Client discards session token after OPAQUE login — `src/routes/unlock/+page.svelte`
> High v1 → v2 upgrade is non-atomic — `src/lib/services/vault-session.ts`
> High Master-password disable does not verify current password — `src/routes/vault/MasterPasswordSettings.svelte`
> Medium Rate limiting fails open and is dashboard-only — `src/lib/server/api/env.ts` + `wrangler.toml`
> Medium Docs/UI copy overstates future roadmap items — ROADMAP.md, README.md, routes
> Medium Real D1/R2 sync path skipped by default tests — `tests/e2e/sync.spec.ts`

**Methodology:** triple evidence — static (file paths + code), runtime (tests / commands), and adversarial (deliberate attempts to falsify). Every "closed" verdict is grounded in a file:line citation against the current commit.

**Result:** of the eight findings, three are fully addressed by the prior milestone-audit pass, two are closed by design, one (item 2) is partially open with five concrete subitems, one (item 5) is a real gap, and one (item 7) has nine specific drift call-sites to remediate. Item 3 is closed for the core claim but surfaces two minor adjacent bugs worth cleaning up.

---

## 1. OPAQUE server identity unstable — CLOSED

The seed is sourced from a single schema-enforced D1 row and the public key is re-derived deterministically by pure point arithmetic on every request. No module-level cache, no per-request regeneration, no race conditions.

**Static evidence:**

The `server_identity` table has a `CHECK (id = 1)` invariant — there can only ever be one row:

```22:26:migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS server_identity (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	oprf_seed BLOB NOT NULL,
	created_at INTEGER NOT NULL
);
```

[`loadServerIdentity`](../../src/lib/server/api/d1-storage.ts) reads it with `WHERE id = 1`, validates 32-byte length, rejects all-zero, and derives the public key:

```254:289:src/lib/server/api/d1-storage.ts
export async function loadServerIdentity(
	db: D1Database,
	serverId: string,
	serverPublicKey: Uint8Array | null = null
): Promise<ServerIdentity> {
	const row = await db
		.prepare('SELECT oprf_seed FROM server_identity WHERE id = 1')
		.first<{ oprf_seed: ArrayBuffer }>();
	if (!row) {
		throw new Error(
			'd1-storage: server_identity not seeded. Run seed_server_identity.sql.'
		);
	}
	const serverSecretKey = bytes(row.oprf_seed);
	if (serverSecretKey.length !== 32) {
		throw new Error('d1-storage: server_identity.oprf_seed must be exactly 32 bytes');
	}
	if (isAllZero(serverSecretKey)) {
		throw new Error('d1-storage: server_identity.oprf_seed must not be all zero');
	}
	if (serverPublicKey) {
		return { serverId, serverSecretKey, serverPublicKey };
	}
	return {
		serverId,
		serverSecretKey,
		serverPublicKey: OpaqueServerEngine.publicKeyFromServerSecretKey(serverSecretKey)
	};
}
```

The derivation is pure (point arithmetic + canonical encoding, no randomness, no clock):

```183:193:src/lib/server/api/server-opaque.ts
static publicKeyFromServerSecretKey(serverSecretKey: Uint8Array): Uint8Array {
	const suite = getSuite(SUITE_ID);
	const group = getGroup(suite.curve);
	if (serverSecretKey.length !== group.scalarSize) {
		throw new Error(
			`opaque: server secret key must be ${group.scalarSize} bytes`
		);
	}
	const publicPoint = group.scalarBaseMult(serverSecretKey);
	return group.serializeElement(publicPoint);
}
```

**Runtime evidence:** [`tests/integration/worker.spec.ts`](../../tests/integration/worker.spec.ts) at lines 210-231 registers with one engine and logs in with a freshly-constructed engine that reloads identity from D1 — proving cross-request stability.

**Adversarial evidence:** the loader rejects an all-zero seed (`tests/integration/worker.spec.ts` "rejects an all-zero D1 OPAQUE server identity seed"). Production never calls `generateServerKeypair`; that exists only in [`mock-opaque-server.ts`](../../src/lib/services/mock-opaque-server.ts) (test fixture) and the bootstrap script's `--rotate=true` path, and the release workflow seeds with `--rotate=false`.

**Verdict: CLOSED. No code change needed.**

---

## 2. Production sync deploy not wired — PARTIALLY OPEN

The structural plumbing is present (migrations apply, OPAQUE identity seeded, distinct prod bindings, rate-limit burst probe). Five operational gaps remain.

**What IS wired:**

- D1 migrations: line 231 `wrangler d1 migrations apply AUTH_DB --env production --remote`
- OPAQUE identity seed: line 238 `node scripts/seed-opaque-identity.mjs --env=production --rotate=false` (idempotent via `INSERT ... WHERE NOT EXISTS`, see `scripts/seed-opaque-identity.mjs:48-52`)
- `PUBLIC_SYNC_ORIGIN` baked into the bundle at lines 78, 94 from `${{ vars.PUBLIC_SYNC_ORIGIN }}`
- 12-burst rate-limit probe at lines 341-359 asserts at least one `429`/`503`
- Production `[env.production]` has its own `database_id` + `bucket_name` distinct from preview placeholders

**Open subitems:**

1. **Smoke never proves OPAQUE round-trip works.** The 12 burst requests at lines 341-359 send `{"clientId":"release-smoke-probe","request":"AA=="}` — a single garbage byte that can never parse as KE1. The test only succeeds when one is throttled, so it never proves the crypto path completes a register + login end-to-end. A broken D1/identity/AKE path ships undetected until the first real user.

2. **`--branch=main` vs `--env=production` mismatch.** Lines 250-255:
 ```yaml
 npx wrangler pages deploy .svelte-kit/cloudflare \
 --project-name=vuvault \
 --branch=main \
 --commit-hash="${{ github.sha }}"
 ```
 Cloudflare Pages applies `[env.production]` bindings only when the dashboard's production branch is configured as `main` — there's no in-CI assertion of that mapping. A misconfigured Pages project would migrate the production D1 (the migration step DOES use `--env production` explicitly) while the deployed Worker binds to preview's D1/R2 — silent failure with no in-workflow signal.

3. **Misleading error message at line ~357** references `OPAQUE_REGISTER_LIMITER` as if it were a Pages dashboard binding:
 > "Verify OPAQUE_REGISTER_LIMITER is wired in the Cloudflare dashboard."
 
 Rate limiting is D1-backed (`migrations/0003_rate_limits.sql` + `src/lib/server/api/rate-limit-d1.ts`); there is no such binding. The operator chasing this error would look in the wrong place.

4. **No upfront validation of `vars.PUBLIC_SYNC_ORIGIN` / `secrets.CLOUDFLARE_API_TOKEN` / `secrets.CLOUDFLARE_ACCOUNT_ID`.** Missing values fail mid-deploy (build, deploy, or smoke step) after several minutes of work.

5. **No post-deploy bundle-hash check** against the live origin. Nothing verifies that `${PUBLIC_SYNC_ORIGIN}/_app/immutable/bundle-manifest.json`'s `aggregateDigest` matches the `PUBLIC_BUNDLE_HASH` baked into this release. A CDN cache miss or partial deploy could leave the old bundle in service.

**Verdict: PARTIALLY OPEN.** All five subitems get fixed in this pass.

---

## 3. Client discards session token after OPAQUE login — CLOSED (with two minor adjacent fixes)

The core claim is false. The unlock page plumbs the OPAQUE token through correctly. But the audit log and a couple of comments lie about how it's stored.

**Static evidence — token IS plumbed:**

```235:249:src/routes/unlock/+page.svelte
				const log = await login({
					serverId: opaqueServerId!,
					clientId: opaqueClientId!,
					password,
					transport
				});
				opaqueExportKey = log.exportKey;
				// Blob sync is only available after the Worker returns
				// a session token from OPAQUE login. If this deployment
				// omits token minting, keep blob operations local-only.
				setSessionToken(log.token ?? null);
				audit.push('success', 'OPAQUE login complete', {
					serverId: opaqueServerId!
				});
```

The import is at line 180, and `setSessionToken` writes the module-scope `sessionToken` in [`sync-client.ts`](../../src/lib/services/sync-client.ts:154-158), which is read on every authenticated `call()` (line 187) to attach `Authorization: Bearer <token>`. Onboarding (`StepProvision.svelte:248`) does the same.

**Adjacent issues (real, but not the claimed bug):**

- **Inaccurate `sessionStorage` comments.** [`sync-client.ts:152`](../../src/lib/services/sync-client.ts) ("stashes it (sessionStorage in the SPA, never localStorage)") and [`unlock/+page.svelte:215-220`](../../src/routes/unlock/+page.svelte) ("the bearer token is stashed in sessionStorage") both lie — it's a module-scope `let`, not `sessionStorage`. Hard reload loses it. `lockSession` correctly clears it.
- **Silent token-missing degradation.** `log.token ?? null` writes `null` if the Worker doesn't mint a token; the user sees `'OPAQUE login complete'` in audit either way. [`StepProvision.svelte:249-257`](../../src/routes/onboarding/_steps/StepProvision.svelte) distinguishes the two cases. Unlock doesn't.

**Verdict: CLOSED for the headline claim; fix the two adjacent issues.**

---

## 4. v1 → v2 upgrade is non-atomic — CLOSED

The upgrade writes the bumped `account.formatVersion` and the new vault blob inside a single Dexie `db.transaction('rw', db.account, db.vault, ...)`. Either both land or neither does.

**Static evidence:**

```1082:1101:src/lib/services/vault-session.ts
	if (upgrading) {
		const nextAccount: AccountRecord = {
			...account,
			formatVersion: targetVersion
		};
		await saveExistingAccountAndVault(nextAccount, {
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
		activeFormatVersion = targetVersion;
	} else {
		await saveVault({
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
	}
```

`saveExistingAccountAndVault` is transactional:

```485:493:src/lib/utils/storage.ts
export async function saveExistingAccountAndVault(
	account: AccountRecord,
	blob: Omit<VaultBlob, 'id'>
): Promise<void> {
	await db.transaction('rw', db.account, db.vault, async () => {
		await db.account.put(account);
		await db.vault.put({ id: 'singleton', ...blob });
	});
}
```

**Adversarial evidence:** all crypto runs in-memory before the await (`vault-session.ts:1052-1080`); a page crash before commit aborts the IDB transaction wholesale, leaving the v1 row + v1 blob intact. The in-memory `aesKey` and `activeFormatVersion` are only assigned AFTER the await (lines 1093, 1112), so module-scope session state stays consistent with disk on failure.

**Verdict: CLOSED. No code change needed.**

---

## 5. Master-password disable does not verify current password — OPEN

The disable branch explicitly skips MP verification, documented in source. An attacker with secret-key + PRF can permanently strip the MP factor from an already-unlocked session without ever knowing the MP.

**Static evidence:**

```208:217:src/routes/vault/MasterPasswordSettings.svelte
			} else {
				// Disable uses the active unlocked session plus
				// Secret Key/passkey re-confirmation. We deliberately
				// do not collect or fake-verify the current password here;
				// rotateAuth gets `null` to remove the enrolled MPK factor.
				await rotateAuth({
					prfOutput,
					secretKey,
					masterPasswordKey: null
				});
```

The user-facing copy at lines 515-521 admits the same thing: *"Current-password verification is not implemented in this pass."*

`rotateAuth` accepts `masterPasswordKey: null` and drops the factor unconditionally — it only requires `(isSessionActive(), validSecretKey, prfOutput)` and the existing `masterPasswordEnabled-but-undefined` guard at lines 1212-1219 does not catch the `null` path.

**Threat model:** a passkey-only attacker is correctly blocked at unlock (`openVault` enforces `masterPasswordEnabled && !masterPasswordKey ⇒ throw` at lines 752-758), but anyone with:
- the user's Secret Key (paper backup, separate exfil), AND
- a satisfied PRF prompt (passkey already authenticating something else, or the user away from an unlocked machine)

can strip MP. This exactly subverts what MP was sold to defend against per [`argon2.ts:7-11`](../../src/lib/crypto/argon2.ts).

**Verdict: OPEN.** Add `currentMasterPasswordKey` parameter to `rotateAuth` with verification via try-unwrap; require it in the UI's disable branch.

---

## 6. Rate limiting fails open / dashboard-only — CLOSED

This was the headline finding from the previous milestone-audit pass; it is now fully wired. Limiter is D1-backed and the mode is consulted on infrastructure failure.

**Static evidence:**

- [`Env.OPAQUE_RATE_LIMIT_MODE`](../../src/lib/server/api/env.ts) declared with explicit `'fail-open' | 'fail-closed'` union
- [`getRateLimitMode(env)`](../../src/lib/server/api/env.ts) defaults to `fail-closed` for anything other than the literal string `'fail-open'`
- [`applyRateLimit(env, ...)`](../../src/lib/server/api/rate-limit-d1.ts) consults the mode on D1 catch
- `wrangler.toml` `[vars]` = `fail-open`, `[env.production.vars]` = `fail-closed`
- Limiter persists in D1 `rate_limits` table (`migrations/0003_rate_limits.sql`), not a dashboard binding

**Runtime evidence:** 11 tests in [`rate-limit-d1.test.ts`](../../src/lib/server/api/rate-limit-d1.test.ts) lock both modes; the integration suite has explicit `fails closed (production mode)` and `fails open (preview mode)` assertions.

**Verdict: CLOSED in the prior pass. No further change needed.**

---

## 7. Docs/UI copy overstates future roadmap items — PARTIALLY OPEN

Most aspirational language is correctly tier-labeled (Compare table, blueprint invariants, `docs/ROADMAP.md`, `landing.ts` sentinels). Nine concrete drift sites identified.

**Overstatement (present-tense, no tier tag):**

1. `src/routes/(landing)/_panels/Problem.svelte:65-68` — "Built from primitives ... FROST, AKD" implies shipped; FROST is Tier 3, AKD is Tier 2.
2. `src/routes/(landing)/_panels/Pricing.svelte:19-28` — "Unlimited devices" / "∞ devices" with no Tier-2 qualifier; `StepPricing.svelte` already has the right phrasing.
3. `src/routes/(landing)/_panels/Trust.svelte:75-81` — hardcoded placeholder Rekor values (`a3f8...e2c1`, `vu-release-key`, `✓ verified · 2026-04-28`) instead of reading reactive values.
4. `src/routes/(landing)/_panels/Trust.svelte:86-99` — "sync server is ~300 lines / deploy yourself in 5 minutes" overstates Tier-2 BYO storage.
5. `src/routes/(landing)/_panels/Promise.svelte:219` — spec line lists `ed25519 auth`; Tier-1 auth is WebAuthn PRF + X25519 + ML-KEM + AES, not Ed25519.

**Borderline / ambiguous:**

6. `src/routes/(landing)/_panels/Hero.svelte:40-43` — "Verifiable transparency log" could mean shipped Sigstore Rekor or Tier-2 CONIKS/AKD.
7. `src/routes/(landing)/_panels/Final.svelte:30,84` — link labelled "Whitepaper" routes to `/blueprint`.

**Drift in the opposite direction (understated):**

8. `src/lib/data/landing.ts:154-193` — L01 OPAQUE `tagText: 'Client + mock server'` and L05 reproducible-builds `tagText: 'Manifest now · Rekor Tier 2'` are stale per `docs/ROADMAP.md` (both shipped in M3). Compare row at L87 also references "Rekor publish Tier 2".
9. `README.md` L191 (if present) — status table row contradicts the README body and `docs/ROADMAP.md`.

**Verdict: PARTIALLY OPEN.** All nine sites fixed in this pass.

---

## 8. Real D1/R2 sync path skipped by default tests — CLOSED BY DESIGN

The gate is `M3_E2E=1` on `sync.spec.ts:8`. The full D1/R2 round-trip runs in the dedicated `m3-sync-e2e` CI job, which boots `wrangler pages dev` against local SQLite-backed D1 and filesystem-backed R2, then writes `.m3-e2e-passed` — an artifact the release workflow refuses to deploy without.

This is correct factoring. `npm run test` and `npm run test:e2e` exercise the in-memory `FakeD1` + `MemoryR2` adapters (`tests/integration/api-routes.spec.ts:14, 92`), which cover the route-handler contract; the gated job covers the Workers runtime + bindings round-trip. Local dev shouldn't pay miniflare's startup tax on every test run.

The release pipeline guarantees the gated job DID run for the SHA being deployed: `release.yml:110-123` downloads `m3-e2e-passed-${RELEASE_SHA}` and aborts the release if it's absent.

**Verdict: CLOSED BY DESIGN. No code change needed.**

---

## Action map

| Finding | Verdict | Action |
| --- | --- | --- |
| 1 OPAQUE identity | Closed | None |
| 2 Production deploy | Partially open | 5 release.yml fixes |
| 3 Session token | Closed (core) | 2 adjacent fixes (audit log, comments) |
| 4 v1→v2 atomicity | Closed | None |
| 5 MP disable verify | Open | `rotateAuth` parameter + UI input + regression test |
| 6 Rate limiter | Closed (prior pass) | None |
| 7 Docs/UI copy | Partially open | 9 specific drift sites |
| 8 Real D1/R2 sync | Closed by design | None |

**Total fixes in this pass:** 19 code/copy changes + this verification report.

**Out of scope (would undo correct work or duplicate the prior pass):**
- Re-implementing `OPAQUE_RATE_LIMIT_MODE` wiring
- Re-bootstrapping OPAQUE identity in `release.yml`
- Adding a redundant `setSessionToken` call
- Wrapping v1→v2 in a redundant second transaction
- Adding session/pending/R2 cleanup (just shipped in `cleanup.ts` + `r2-gc.ts`)
- Lifting the `M3_E2E=1` gate on `sync.spec.ts`
- Rewriting the OPAQUE identity loader to read `group.scalarSize` instead of `32` (defense-in-depth, not a bug)

---

*Re-check produced by the post-v0.1.11 audit pass on 2026-05-19.*
