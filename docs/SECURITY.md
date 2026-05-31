# VuVault Security Model

> **The single hardest invariant**: the server is *mathematically incapable* of reading user data. If you find a code path that violates this — even theoretically, even with extreme adversarial assumptions — that's a P0 bug. File it. We'll ship a fix.

> **See also**: [`docs/PRIVACY-LEVEL.md`](./PRIVACY-LEVEL.md) tracks the honest, code-tied snapshot of what is shipped vs partial vs pending. Marketing copy must match that document, never this one alone.

---

## Scope of the zero-knowledge claim

VuVault claims that the server cannot:

1. Read any vault item (login, card, note, identity, document metadata, SSH key, crypto seed) or document file body
2. Read any item metadata (URL, tag, kind) beyond what's necessary for sync routing
3. Determine the contents of a synchronized blob from its size or update frequency *(planned in Tier 2 — current implementation does not pad. The vault-codec and the document sealer both encrypt under AES-256-GCM and write the resulting ciphertext at its natural length; bucketed padding is part of the Tier 2 sync server design and has not yet been wired into [`src/lib/crypto/vault-codec.ts`](../src/lib/crypto/vault-codec.ts) or [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts) `sealDocument`)*
4. Distinguish between a 2-page lease and a 200-page contract *(see (3) — same constraint, same Tier 2 dependency)*
5. Identify which devices are paired with which user without their explicit cooperation *(planned in Tier 2 — depends on the L08 device-pairing flow; today every successful OPAQUE login mints a server-side session token)*
6. Replay or reorder vault updates undetected *(the §L07b metadata-minimization pass dropped the server-side sequence clock — [`migrations/0009_drop_sequence_clock.sql`](../migrations/0009_drop_sequence_clock.sql) — to close V1-C3, so a passive server can no longer order or correlate writes across accounts. Write ordering is now a client-only monotonic save counter held inside the client-side encrypted inventory (`inventoryLatestIndex` in [`src/lib/services/inventory-session.ts`](../src/lib/services/inventory-session.ts)), compared against the device's last-seen index on pull. Document blobs are content-addressed by UUID and authenticated by AAD-bound AES-GCM. CONIKS-derived AKD log anchoring still ships in Tier 2)*

Today, claim (1) holds *architecturally* for both vault items and document file bytes: server routes under [`src/routes/api/opaque/`](../src/routes/api/opaque/), [`src/routes/api/v2/blobs/[uuid]/`](../src/routes/api/v2/blobs/[uuid]/+server.ts), and [`src/routes/api/v2/inv/[addr]/`](../src/routes/api/v2/inv/[addr]/+server.ts) store opaque ciphertext only — the §L07b pass retired the legacy per-account `/api/blobs/*` and `/api/documents/*` routes, so blobs are now keyed by random UUID with no account prefix (V1-C1) — with AES-256-GCM happening client-side in [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts). When `PUBLIC_SYNC_ORIGIN` is empty, [`src/lib/services/sync-client.ts`](../src/lib/services/sync-client.ts) returns `NOT_WIRED` and the local-only path is the only one exercised — claim (1) still holds trivially. Claim (2) is *partial*: the sync server still observes the size of each whole-vault blob and each document blob (Tier 2 padding is the remediation). The on-disk zero-knowledge invariant is asserted programmatically by [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts), which dumps the encrypted IndexedDB rows and refuses any plaintext substring leak.

The claim does **not** extend to:

- Whether a particular user account exists (account-existence oracle is unavoidable for OPAQUE)
- The total volume of synchronized data per account (rate-limit and abuse-prevention need this)
- Which IP addresses connect (requires onion routing on the user side)

---

## Cryptographic primitives in use

| Layer | Primitive | Source | Rationale |
| --- | --- | --- | --- |
| Authentication | OPAQUE | RFC 9807 (Jul 2025) | Server holds opaque envelopes, not password hashes |
| Vault key derivation | HKDF-SHA512 | NIST SP 800-56C | Standardized KDF, hardware-accelerated |
| Symmetric encryption | AES-256-GCM | NIST SP 800-38D | Hardware AES-NI everywhere; AEAD |
| Asymmetric (classical) | X25519 | RFC 7748 | Constant-time, small keys |
| Asymmetric (post-quantum) | ML-KEM-1024 | FIPS 203 (Aug 2024) | NIST-standardized; Tier 1 layer |
| Hash | SHA-384 / SHA-512 | FIPS 180-4 | Length-extension safe via HMAC |
| MAC | HMAC | RFC 2104 | Pairs with SHA-2 |
| WebAuthn | Level 3 + PRF | W3C / FIDO | Hardware-backed; PRF unlocks vault key |
| Local Recovery Envelope | Argon2id + HKDF-SHA512 + AES-256-GCM | RFC 9106 / NIST SP 800-56C / NIST SP 800-38D | Passkey-loss recovery without server-held recovery material |
| Random | `crypto.getRandomValues` | W3C Web Crypto API | Browser-vetted CSPRNG |

We do **not** use:

- ❌ MD5, SHA-1 (except for legacy TOTP per RFC 6238)
- ❌ DES, 3DES, RC4
- ❌ ECB mode, CBC without HMAC-then-encrypt construction
- ❌ Any "rolled our own" primitive

---

## Threat model

> **2026-05-22 Phase 2 update.** The session-mint redesign that
> ships with `migrations/0004_metadata_minimization.sql` closes the
> `V1-C2` criterion in
> [`docs/VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md):
> the server no longer stores per-device identifiers
> (`sessions.device_id`, `accounts.last_login_at`, and the
> `device_pairings` table are dropped).
>
> **2026-05-25 Vu0 full-crypto update.** All three V0-C* criteria
> close in this build:
>
> - **V0-C1** unlinkable routing identifiers — AKD epochs publish
>   a Merkle root with per-epoch Ed25519-VRF + Ed25519 signature.
>   §L09cap capability handles derive from `accountSeed` via
>   RFC 9497 VOPRF (Ristretto255). The `X-Vu0-Capability` header
>   is accepted on every V2 route alongside legacy Bearer auth.
>   Different-epoch capabilities for the same accountSeed are
>   provably unlinkable (see `voprf.test.ts > V0-C1
>   unlinkability`).
>
> - **V0-C2** bucketed blob sizes — vault format version 3 wires
>   `padPlaintext`/`unpadPlaintext` into seal/open. Document blobs
>   carry a 1-byte v1 marker inside the AAD-bound plaintext so
>   legacy unpadded reads still work transparently. Ciphertext
>   lengths are powers of two ≥ 256 + the AES-GCM tag.
>
> - **V0-C3** no account-existence oracle — `/api/opaque/login/ke1`
>   performs dummy OPRF work on the unknown-clientId path so
>   response timing closely matches the existing-account path.
>   Error message is the generic `"invalid login request"` rather
>   than the legacy `"unknown clientId"` string.
>
> **Residual gap:** the OPAQUE handshake protocol still requires
> a stable per-account identifier to load the envelope. The Vu0
> claim in this build is: **"after OPAQUE login, the server
> cannot link a session's subsequent requests to the account
> that logged in."** Full per-handshake unlinkability requires a
> Tier-3+ ZK-proof layer. See
> [`docs/verifications/2026-05-26-vu0-uplift.md`](./verifications/2026-05-26-vu0-uplift.md).

### Adversaries we defend against

**A1. Passive network observer.** Defeated by TLS 1.3 + HSTS + OPAQUE.

**A2. Active network MITM.** Defeated by HPKP-style certificate pinning + Subresource Integrity + Sigstore-attested bundles.

**A3. Compromised server.** Defeated by client-side encryption. Server holds opaque blobs.

**A4. Coerced server operator (court order, NSL).** Defeated by mathematical incapability — the server cannot produce plaintext because it doesn't have the keys. (We can produce ciphertext; that's deliberately useless.)

**A5. Malicious update / build-system attacker.** Defeated by reproducible builds, Sigstore + Rekor transparency log, and bundle-hash verification at every unlock.

**A6. Harvest-now-decrypt-later quantum adversary.** Defeated by hybrid X25519+ML-KEM-1024 envelope. A vault stolen today remains undecryptable post-Q-day.

**A7. Phishing of master password.** Defeated by OPAQUE (server never sees the password) and WebAuthn-PRF (the password isn't even the unlock factor).

### Adversaries we explicitly do not defend against

**B1. Endpoint compromise.** If your device is owned, your vault is owned when unlocked. We zeroize aggressively but cannot defeat persistent endpoint malware.

**B2. Coercion of the user.** Plausible deniability features (time-windowed decoy vaults) help; coercion-resistance is not a complete defense.

**B3. Side-channel attacks against the platform's WebCrypto implementation.** This is a browser-vendor problem. We mitigate by using only constant-time primitives where we control the impl.

**B4. Implementation bugs in our code.** Defended by audits, fuzzing, and bug bounties — not by architecture.

**B5. Sophisticated targeted nation-state attackers** with capability to compromise the user's TPM/Secure Enclave + device firmware + browser update channel simultaneously. If you are this user, you have larger problems than a password manager.

**B6. Offline guessing of a weak Recovery Password.** The local Recovery
Envelope is still zero-knowledge with respect to the server, but an attacker
who steals the Secret Key and either IndexedDB or an exported `.vukey` can test
Recovery Password guesses offline at the configured Argon2id cost. This is why
the Recovery Password is separate, warned on setup, centrally policy-checked
at creation/rotation (minimum 16 characters, approximately 80-bit target, no
common/app-term/Secret-Key-containing values), and never printed inside the
Emergency Kit.

### Browser hardening contract

Production responses set a single audited header contract from SvelteKit hooks
and Cloudflare `_headers`: HSTS preload, `nosniff`, `no-referrer`,
`X-Frame-Options: DENY`, a locked-down `Permissions-Policy`, COOP
`same-origin`, and CORP `same-origin`. CSP also denies objects and frames,
restricts workers/media/manifests to self, and upgrades insecure requests.
COEP and Trusted Types are intentionally deferred until Argon2 WASM and browser
compatibility are validated.

### Unlocked-session exposure limits

The vault auto-locks after 5 minutes idle, 30 seconds in a hidden tab, and on
`pagehide`/freeze where supported. Lock zeroizes vault keys and decrypted item
state, clears the sync bearer token, hides revealed fields, and best-effort
clears the clipboard. This reduces exposure windows; it does not defeat endpoint
malware that can read the page while the user is actively unlocked.

### Clipboard and reveal limits

All secret copy paths use a centralized clipboard helper that schedules a
best-effort clear after 60 seconds and clears immediately on lock. Browser
permission models may reject clipboard writes/clears, so users should still
treat copied secrets as exposed to the local OS clipboard manager. Reveals are
field-scoped and auto-hide after 30 seconds.

---

## Reporting a vulnerability

Email **security@vault.vu** with the details. PGP key on `https://vault.vu/.well-known/pgp.txt`.

We aim to acknowledge within **24 hours**, triage within **72 hours**, and ship a patch within **30 days** for confirmed P0/P1 issues.

Bug bounty rates (preliminary):

| Severity | Range |
| --- | --- |
| Zero-knowledge break (server can read plaintext) | $50,000 |
| Cross-vault data exposure | $20,000 |
| Authentication bypass | $10,000 |
| Practical key recovery | $10,000 |
| Other crypto weakness | $1,000–$5,000 |
| Memory disclosure / unlock bypass | $500–$2,000 |

We do not pursue legal action against good-faith researchers.

---

## Audit history

| Date | Auditor | Scope | Report |
| --- | --- | --- | --- |
| TBD | TBD | Full Tier 1 stack | Public PDF on launch |

---

## What "verifiable" means here

When the onboarding flow shows you a bundle hash, that hash is:

1. The SHA-384 of the JavaScript bundle currently running in your browser
2. The same hash recorded in the Sigstore Rekor transparency log when this version was published
3. Reproducible from the public source — anyone can rebuild from `git checkout v0.1.0 && npm run build` and get the same hash

If your hash doesn't match the public Rekor entry, **do not unlock your vault**. Something is wrong. Check `https://search.sigstore.dev/?hash={your-hash}`.

This is what *verifiable by anyone* means. It's the strongest claim a software vendor can make, and we make it deliberately because it's the only kind of trust that survives organizational change.
