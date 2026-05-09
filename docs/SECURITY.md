# VuVault Security Model

> **The single hardest invariant**: the server is *mathematically incapable* of reading user data. If you find a code path that violates this — even theoretically, even with extreme adversarial assumptions — that's a P0 bug. File it. We'll ship a fix.

---

## Scope of the zero-knowledge claim

VuVault claims that the server cannot:

1. Read any vault item (login, card, note, identity, document, SSH key, crypto seed)
2. Read any item metadata (URL, tag, kind) beyond what's necessary for sync routing
3. Determine the contents of a synchronized blob from its size or update frequency *(planned in Tier 2 — current implementation does not pad. The vault-codec encrypts under AES-256-GCM and writes the resulting ciphertext at its natural length; bucketed padding is part of the Tier 2 sync server design and has not yet been wired into [`src/lib/crypto/vault-codec.ts`](../src/lib/crypto/vault-codec.ts))*
4. Distinguish between a 2-page lease and a 200-page contract *(see (3) — same constraint, same Tier 2 dependency)*
5. Identify which devices are paired with which user without their explicit cooperation *(planned in Tier 2 — depends on the OPAQUE-bound device registration flow that ships with the M3 sync server)*
6. Replay or reorder vault updates undetected *(planned in Tier 2 — depends on the sequence-clock + Merkle-anchored blob index that ships with the M3 sync server)*

Today, claims (1) and (2) hold *trivially* because the local-only build never sends a blob anywhere — the M3 sync server is an HTTP 501 stub at [`functions/api/[[catchall]].ts`](../functions/api/[[catchall]].ts) and [`src/lib/services/sync-client.ts`](../src/lib/services/sync-client.ts) returns `NOT_WIRED` for every method. They become *architecturally* enforced (rather than vacuously true) when the M3 sync server ships.

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
| Random | `crypto.getRandomValues` | W3C Web Crypto API | Browser-vetted CSPRNG |

We do **not** use:

- ❌ MD5, SHA-1 (except for legacy TOTP per RFC 6238)
- ❌ DES, 3DES, RC4
- ❌ ECB mode, CBC without HMAC-then-encrypt construction
- ❌ Any "rolled our own" primitive

---

## Threat model

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
