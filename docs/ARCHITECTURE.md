# VuVault Architecture

**Version**: 0.5.0
**Status**: Tier 1 implementation in progress
**Companion**: `src/routes/blueprint/+page.svelte` is the live, in-app version of this document

---

## Foundational claim

> **The server is mathematically incapable of accessing user data.**

This is the difference between *policy privacy* (a company promises not to look) and *architectural privacy* (the company built the system so they can't). VuVault is the latter. Every claim in this document, every line of crypto code, every API endpoint exists to preserve this invariant.

If a single layer in the stack would let the server, an Anthropic-style AI agent, a court order, or a coerced employee read user data — that layer is not VuVault. It belongs to a different product.

---

## The four shipping tiers

| Tier | Window | Risk profile | What ships |
| --- | --- | --- | --- |
| **Tier 1** | Q3 2026 | Zero research risk; libraries audited | OPAQUE, PRF derivation, ML-KEM-1024 envelope, XMSS release sigs, reproducible builds |
| **Tier 2** | 2027 | Standards mature; integration complexity | MLS sharing, encrypted CRDT sync, CONIKS AKD log, PIR breach checks |
| **Tier 3** | 2028 | Threshold crypto + TEEs | FROST recovery, Nitro/Confidential enclaves, Noise-channel agentic autofill, FN-DSA |
| **Tier 4** | 2029–2030 | Research-adjacent | zkSNARK selective disclosure, drand timelock, threshold HBS, pure-PQ recovery |

---

## Layers (18 total)

### Tier 1 — Production (Q3 2026)

**L01. OPAQUE authentication** (RFC 9807, July 2025)
The server holds an OPAQUE envelope, not a password hash. A breach of the server reveals nothing usable. Phishing-resistant by construction.

**L02. PRF + Secret Key derivation** (WebAuthn L3 PRF · HKDF-SHA512)
The vault key never leaves this device. It's derived from `HKDF-SHA512(PRF_output ‖ Secret_Key, salt = device_salt)`. Touch ID authenticates, but it also unlocks — same biometric.

**L03. ML-KEM-1024 hybrid envelope** (FIPS 203, August 2024) *— shipped in M2*
Per-vault hybrid X25519 + ML-KEM-1024 KEM, wrapping AES-256-GCM with a header-bound AAD. A vault stolen today remains undecryptable in 2032+ even with scalable quantum cryptanalysis. Hybrid means we are no weaker than X25519 alone if ML-KEM is broken. The ML-KEM-1024 implementation comes from `@noble/post-quantum` and is locked against curated FIPS 203 KAT vectors via `npm run test:fips` so a silent upstream change to keygen / encapsulate output bytes fails CI loudly. The envelope-wrap implementation lives in `src/lib/services/vault-envelope.ts`; per-vault format v2 unwrap dispatch is in `src/lib/services/vault-session.ts`.

**L04. XMSS release signatures** (NIST SP 800-208)
Stateful hash-based signatures over every release artifact. Quantum-safe by 1990s primitives — no novel mathematical assumptions.

**L05. Reproducible builds + Sigstore** (SLSA L3 · Rekor transparency log)
Every published bundle is reproducible from source. The bundle hash is in a public append-only Rekor log. We cannot ship a targeted backdoor; the divergence would be visible.

### Tier 2 — Sync & sharing (2027)

**L06. MLS family/team sharing** (RFC 9420 / RFC 9750)
Continuous-group key-agreement protocol — invented for end-to-end encrypted messaging at scale. Departing members lose access on the next epoch.

**L07. Encrypted CRDT sync** (Yjs + HPKE + ML-KEM-768)
Vault items represented as CRDTs encrypted at the field level. Sync server sees opaque ciphertext deltas; it cannot infer item structure or relations.

**L08. WebRTC + ECDH device pairing**
Local-first device pairing with no server intermediation. ECDH over the local network, with QR-code-bound mutual authentication.

**L09. CONIKS-derived auditable key directory**
Same pattern Meta uses for WhatsApp/iMessage/Messenger. The server publishes a Merkle commitment over all public keys; any divergence is provable.

**L10. PIR + unbalanced PSI breach checks** (RFC 9497 VOPRF · OPRF-PSI)
Check whether your password is in HIBP without revealing it to anyone — including us. Private Information Retrieval over the breach corpus.

### Tier 3 — Recovery & autonomy (2028)

**L11. FROST t-of-n recovery** (RFC 9591)
Threshold Schnorr signatures. Recovery requires `t` of `n` shares — designate three trusted contacts, two-of-three to recover. No single person, including you, can recover alone.

**L12. TEE enclaves** (AWS Nitro · Azure Confidential)
For server-side operations that must touch even ciphertext metadata, run them inside attested TEEs with public attestation reports.

**L13. Noise-channel agentic autofill** (Noise IK pattern; modeled on 1Password+Browserbase, Oct 2025)
When AI agents autofill credentials, they do so over a Noise IK channel. The agent sees the credential only inside the channel; logs see only ciphertext.

**L14. FN-DSA compact signatures** (FIPS 206 draft, August 2025)
Falcon-derived post-quantum signatures with significantly smaller artifacts than ML-DSA. Used where bandwidth matters: device pairing, sync deltas.

### Tier 4 — Frontier (2029–2030)

**L15. zkSNARK selective disclosure** (Groth16 · Plonky3)
Prove "this driver's license shows I'm over 21" without revealing the license, the date of birth, or the address.

**L16. drand timelock encryption** (tlock over BLS12-381, GA 2023)
Encrypt a will, an emergency note, or a dead-man release to a future date. Nobody — including you — can decrypt before the threshold network publishes that round.

**L17. Threshold stateful HBS** (Haystack, CIC 2025)
XMSS-style signatures, but the state is shared across `t` of `n` parties. Combines quantum safety with operational fault tolerance.

**L18. Pure-PQ threshold recovery**
RACCOON-style ML-DSA threshold signatures. The Tier 3 FROST recovery becomes quantum-safe end-to-end.

---

## Threat model boundaries

VuVault is designed to defend against:

- ✅ Server compromise (full database breach, including OPAQUE envelopes)
- ✅ Server coercion (subpoena, NSL, gag order, employee threat)
- ✅ Network observers (TLS-MITM, ISP, hostile WiFi)
- ✅ Harvest-now-decrypt-later quantum adversaries
- ✅ Malicious updates / targeted backdoors (via reproducible builds + Rekor)
- ✅ Cross-site password reuse (Secret Key per device)
- ✅ Phishing (OPAQUE + WebAuthn)

VuVault explicitly **does not** defend against:

- ❌ Endpoint compromise (the device the user is on)
- ❌ Coercion of the user themselves (rubber-hose attacks)
- ❌ Side-channel attacks against TEEs (when Tier 3 ships)
- ❌ Quantum adversaries with state recovery against current Web Crypto API (browser-implementation-dependent)
- ❌ Implementation bugs (mitigated by audits, not architecture)

---

## What this implementation includes today

This scaffold implements **Tier 1 substantially**:

- **L01 OPAQUE** (RFC 9807): client-side facade shipped via `@structured-id/opaque` (pinned, exact-version) wrapped in `src/lib/services/opaque-client.ts`, exercised in tests by an in-process `mock-opaque-server.ts`. The cross-origin server is part of the M3 sync ship; until then `src/lib/services/sync-client.ts` returns `NOT_WIRED`.
- **L02 PRF + Secret Key + Argon2id**: real `crypto.getRandomValues`, real `navigator.credentials.create` with PRF extension, real HKDF-SHA512, optional Argon2id master-password derivation (RFC 9106 algorithm; `VAULT_HIGH_PARAMS` preset = 256 MiB, 4 passes, p=1; self-hosted WASM under `static/argon2id/`).
- **L03 ML-KEM-1024 hybrid envelope**: shipped end-to-end. Hybrid X25519 + ML-KEM-1024 KEM via `@noble/post-quantum` (FIPS 203), wrapping AES-256-GCM with header-bound AAD. Vault format v2 wraps a per-vault AES key under this hybrid envelope; v1→v2 migration is transparent on first save. Locked under `npm run test:fips` against curated KAT vectors at `src/lib/crypto/kat/ml-kem-1024.json`.
- **L04 XMSS**: not implemented client-side (it's a build-system / release-tooling concern).
- **L05 Reproducible builds**: SHA-384 bundle manifest emitted by `scripts/build-manifest.mjs` at build time, recomputed in-browser by `verifyBundleIntegrity()` on every unlock; mismatch refuses decryption. Sigstore Rekor publishing lands with M3 release tooling.

See `ROADMAP.md` for the M3+ build-out plan.
