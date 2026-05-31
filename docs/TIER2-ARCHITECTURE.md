# Tier 2+ Architecture Specification

**Status:** Forward-looking specification. **No code in this document is shipped.**
**Scope:** Layers L06–L18 from [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).
**Purpose:** Replace ambiguous marketing claims with concrete interface contracts so:

1. When implementation begins, engineers have a starting specification rather than a blank page.
2. Auditors evaluating Tier 1 can verify that Tier 2+ claims do NOT leak into shipped code (they should find this document and nothing else).
3. The roadmap claim "MLS, CRDT, WebRTC pairing, AKD, PIR, FROST are not implemented" remains accurate because every claim points here, and this document is explicit about being a spec.

Each section follows the same shape: motivation, primitives, public interface, persistence schema, server route contract, threat model delta, dependencies, integration points, open issues.

> **Vu Level migration.** This spec, as currently written, advances
> the product from Vu Level 2 to a checkpoint just short of Vu
> Level 1. Three sub-specs identified by
> [`docs/VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md) are
> still required before Tier-2 implementation can close the level
> gap mechanically: **L07b** (per-blob random keys + client-side
> inventory) closes V1-C1 + V1-C3, **L08 session-mint redesign**
> closes V1-C2, and **L09cap** (capability-based request handles)
> closes V0-C1 + V0-C3. The §L07 / §L08 / §L09 sections below are
> the L07a / L08-pairing / L09-AKD halves; the migration-map
> document is the canonical list of what's still owed.

---

## L06 — MLS family/team sharing

> **Tier:** 2 — 2027
> **Standards:** RFC 9420 (MLS protocol), RFC 9750 (architecture)

### Motivation

Today VuVault is single-user. L06 introduces N-party encrypted vaults where each member's device holds a current group key, departing members lose access on the next epoch, and the server never sees plaintext.

### Primitives

- **MLS ciphersuite:** `MLS_128_HPKEX25519_CHACHA20POLY1305_SHA256_Ed25519` for ciphertext, with a parallel post-quantum suite (`MLS_*_DHKEMP384_*` or HPKE-PQ once standardized) layered as a hybrid.
- **Welcome message** for join, **commit** for membership changes.
- **Group context** rolled into AAD on every encrypted vault item that is shared in this group.

### Public interface (sketch)

```ts
// src/lib/services/mls-group.ts (FUTURE)

export type MlsGroupId = string;
export type MlsLeafNode = { credentialId: string; signingPublicKey: Uint8Array };

export interface MlsGroup {
	id: MlsGroupId;
	epoch: bigint;
	members: MlsLeafNode[];
}

export interface MlsGroupService {
	create(name: string): Promise<MlsGroup>;
	addMember(group: MlsGroupId, invite: MlsLeafNode): Promise<MlsGroup>;
	removeMember(group: MlsGroupId, leafIndex: number): Promise<MlsGroup>;
	encryptVaultItem(group: MlsGroupId, plaintext: Uint8Array): Promise<Uint8Array>;
	decryptVaultItem(group: MlsGroupId, ciphertext: Uint8Array): Promise<Uint8Array>;
}
```

### Persistence

- New D1 table `mls_groups(group_id PRIMARY KEY, epoch, ratchet_tree_blob, last_commit_at)`.
- New D1 table `mls_membership(group_id, account_id, leaf_index, PRIMARY KEY(group_id, account_id))`.
- Each member's local IndexedDB gets a `mlsGroupState` table holding the encryption / signing keys (sealed under the existing v2 envelope).

### Server route contract

- `POST /api/mls/groups` create
- `POST /api/mls/groups/{id}/welcome` deliver Welcome to a new member (server stores ciphertext)
- `POST /api/mls/groups/{id}/commit` deliver Commit to group (server fan-outs to all members on next pull)
- `GET /api/mls/groups/{id}/messages?since=<epoch>` pull missed messages

The server sees: group existence, member-count, message-size, commit cadence. The server cannot see: who can decrypt, what's encrypted, who added/removed whom.

### Threat model delta

| Threat | Tier-1 today | Tier-2 with MLS |
| --- | --- | --- |
| Departing member retains access | N/A (single user) | Defeated by MLS post-removal commit forward secrecy |
| Server learns membership graph | N/A | Mitigated by MLS but not eliminated — server still routes messages between IDs |
| Compromised member device | Single account only | Group-wide forward secrecy after next commit |

### Dependencies

- A vetted MLS library. Candidates: `mls-rs` (Rust → wasm), `OpenMLS` (Rust → wasm), `@web5/mls`. **None pinned today.** A library choice is itself a P0 review.
- HPKE — should already be in the bundle by the time L07 ships.

### Integration points

- Vault item types gain a `groupId?: MlsGroupId` field.
- `vault-session.ts::saveItems` branches on `groupId`: if set, encrypt under MLS rather than the per-vault hybrid envelope.
- Onboarding adds a "join a group" path mirroring the recovery-flow shape.

### Open issues

- Group recovery if all admins lose devices simultaneously. Likely requires Tier-3 FROST.
- Cross-tier key isolation: an L07 CRDT delta inside an L06 group is encrypted with the group key, not the per-vault key. The CRDT layer needs MLS awareness.

---

## L07 — Encrypted CRDT sync

> **Tier:** 2 — 2027
> **Standards:** Yjs CRDT + HPKE + (eventually) ML-KEM-768 hybrid
> **Prior art:** [`docs/L07-CRDT-SYNC-PLAN.html`](./L07-CRDT-SYNC-PLAN.html) is the detailed prose plan; this section is the contract surface.

### Motivation

Today each vault save re-encrypts the full vault and uploads it as one R2 blob. That is correct but inefficient and exposes a coarse blob-size oracle. L07 represents vault items as field-level CRDTs, encrypts every Yjs update with HPKE, and lets the server merge opaque deltas.

### Primitives

- **Yjs document** per vault.
- **HPKE seal** per Yjs update, using the per-vault hybrid keypair from L03.
- **Bucketed padding** on every update so size is a poor side channel (see SECURITY.md §3).

### Public interface (sketch)

```ts
// src/lib/services/crdt-sync.ts (FUTURE)

export interface VaultCrdt {
	id: string;
	ydoc: Y.Doc;
	awareness?: Awareness;
}

export interface CrdtSyncService {
	open(vaultId: string): Promise<VaultCrdt>;
	applyLocalChange(vaultId: string, change: (doc: Y.Doc) => void): Promise<void>;
	pullRemoteUpdates(vaultId: string, since: Uint8Array): Promise<Uint8Array[]>; // ciphertext deltas
	close(vaultId: string): Promise<void>;
}
```

### Persistence

- IndexedDB `crdtUpdates` table: `vaultId, updateIndex, encryptedDelta, createdAt`.
- R2 stores ciphertext deltas at `vaults/{accountId}/crdt/{updateIndex}.bin`.
- D1 stores per-account `latestCrdtIndex` so pull-since-N is a single index.

### Server route contract

- `POST /api/crdt/{vaultId}/updates` upload one ciphertext delta
- `GET /api/crdt/{vaultId}/updates?since=N` page through deltas
- `POST /api/crdt/{vaultId}/compact` (rare) merge old deltas into a single ciphertext snapshot

### Threat model delta

| Threat | Tier-1 today | Tier-2 with CRDT |
| --- | --- | --- |
| Sync server sees full-vault size on every save | Yes | No — sees per-delta padded size |
| Conflict resolution on multi-device edits | N/A (single device) | Resolved by Yjs convergence |
| Replay of older delta | Mitigated by sequence clock | Mitigated by Yjs causal order + server index |
| Size oracle from delta growth | N/A | Mitigated by bucketed padding |

### Dependencies

- `yjs` (NOT in package.json today)
- HPKE library compatible with hybrid X25519 + PQ KEM

### Integration points

- `vault.svelte.ts` swaps from item array to Yjs map operations.
- `vault-session.ts` no longer re-encrypts whole vault on save — only the new Yjs update.
- M1 health buckets (weak / reused) recompute from CRDT state.

### Open issues

- Padding profile. Power-of-two buckets vs k-anonymity buckets. Needs empirical evaluation.
- Compaction policy. How often, and who triggers it?

---

## L07b — Per-blob random keys + client-side encrypted inventory

> **Tier:** 2 — 2027 (after L07a lands)
> **Status:** **`awaiting Appendix B.1 sign-off`** — bootstrap mechanism is the open hard part.
> **Closes:** [`VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md) **V1-C1** (no per-user blob inventories) and **V1-C3** (no cross-account sequence-clock correlation).

### Motivation

L07a (above) eliminates the size oracle by encrypting + padding CRDT deltas, but its R2 layout still embeds the account identifier in every key: `vaults/{accountId}/crdt/{updateIndex}.bin`. The server sees per-account blob counts, update sequences, and timing — which is precisely what the migration-map V1-C1/V1-C3 criteria require to go away.

`PRIVACY_AUDIT.md` F-003 records exactly this: *"Either lower claims to canonical Vu2, or redesign sync around unlinkable identifiers, blinded routing, and metadata minimization with explicit limits."* L07b is that redesign.

### Recommended variant — (a) per-blob random keys

Two variants were considered. **(a) is recommended** as the minimum-viable per F-003. **(b) is recorded for completeness and explicitly rejected** for Tier 2.

**Variant (a) — per-blob random keys + client-side encrypted inventory pointer.**
- R2 key shape: `blobs/{uuid}.bin`. **No** account component.
- The client keeps the list of its own blob UUIDs inside the encrypted vault content. The server never receives that list.
- All R2 reads/writes carry a UUID supplied by the client (along with a capability authorizing the operation — see §L09cap once it lands).
- GC is reference-counted (sweeps against the encrypted inventory the client provides on each session) rather than per-account-prefix-enumerated.

**Variant (b) — PIR-style bucketed blob storage. REJECTED for Tier 2.**
- Every account fetches the same N buckets per epoch; oblivious-RAM-flavored.
- Pros: provably hides which blob belongs to which account, even against a colluding R2 + server.
- Cons: bandwidth + storage cost scales with the WHOLE corpus per user (or every account does N reads even for a single update). Not viable at $25.60/year.
- Revisit only if a future post-quantum sub-linear PIR construction makes it cheap enough.

### The bootstrap problem (open, requires Appendix B.1 sign-off)

Variant (a) has a genuine open design question that this spec cannot resolve without maintainer sign-off:

> **After a fresh restore (no local vault, no inventory) — and given that V1-C1 forbids any stable per-user identifier on the server side — how does a client discover its own blob UUIDs?**

The naive solution (a singleton inventory blob at `inv/{H(vaultKey)}` per user) **does not close V1-C1**: it just renames the per-user identifier. The server still sees a stable address that maps 1:1 to the user.

Four candidate solutions, each with the precise trade-off the maintainers must weigh:

#### Candidate 1 — Deterministic-first-pointer + rotated-thereafter

- The first inventory pointer at account birth is `addr_0 = HKDF(vaultKey, salt=deviceSalt, info="vuvault-inv-bootstrap-v1", L=16)`.
- After each write, the *next* inventory address is sealed inside the current inventory blob: `addr_{n+1} = randomBytes(16)`, encrypted alongside the inventory contents.
- Client-side state tracks the current `addr_n` between sessions.
- **Compromise:** at fresh restore, the client falls back to `addr_0`. The server has seen `addr_0` accessed once (at account birth) and possibly never again. The server **can** correlate "this user has ever existed" via `addr_0`, but cannot enumerate intermediate inventory writes.
- **V1-C1 status:** ⚠️ partially closed — the deterministic root remains a stable per-user identifier the server can probe, even if subsequent writes are unlinkable. Fresh-restore observability is a one-shot leak.

#### Candidate 2 — Capability-derived pointer (binds to L09cap)

- The inventory pointer is derived per-AKD-epoch from `(L09cap_capability, accountSeed)`. Each epoch produces a fresh, server-unlinkable address.
- The client at fresh restore re-derives the current capability against the latest AKD epoch (L09 is server-side public; capability derivation is client-side from `vaultKey` + epoch root).
- **Compromise:** L09cap is itself an `awaiting sign-off` spec (§L09cap below). L07b cannot land without it.
- **V1-C1 status:** ✅ fully closed — no stable per-user observation.
- **Cost:** couples L07b's Phase 4 implementation to L09cap's Phase 7+ scheduling, which contradicts the migration-map dependency graph (which has L07b in Phase 4 and L09cap in Phase 7+).

#### Candidate 3 — TEE-attested server-side opaque routing

- An attested TEE on the server side holds a `OPAQUE_export_key → current_inventory_addr` map. Clients submit `OPAQUE_export_key` (which already exists post-KE3); the TEE returns the current address.
- The TEE's attestation report is verifiable by anyone; the TEE memory is sealed against the rest of the server.
- **Compromise:** introduces Tier-3 (L12 TEE enclaves) as a hard dependency on Tier-2 work. Operational complexity, AWS Nitro / Azure Confidential lock-in, attestation freshness story.
- **V1-C1 status:** ⚠️ closed under the TEE attestation assumption — not pure-architectural.

#### Candidate 4 — Two-step fetch via an unauthenticated content-addressed "boot record"

- At account birth the client writes a one-time `boot/{H(deviceSeed)}.bin` blob, where `deviceSeed` is a fresh random the client persisted in a printable Emergency Kit (the same backup vector as the existing Secret Key).
- This boot record contains the current inventory pointer, encrypted under `vaultKey`.
- The pointer is rotated per-write; the boot record's address is rewritten in place. Server sees one stable per-account address (the boot record's), same problem as Candidate 1.
- **V1-C1 status:** ⚠️ partially closed — equivalent to Candidate 1 in observability terms, but with the burden of an Emergency-Kit field for `deviceSeed`. Higher UX cost, no better V1-C1 closure.

### Recommendation to maintainers

- **Phase 4 minimum-viable: Candidate 1.** Acknowledges V1-C1 as ⚠️ partially closed (the deterministic-first-pointer is a one-shot leak at restore). Honest framing in `PRIVACY-LEVEL.md`: "Vu Level 1 with a documented fresh-restore observability footprint."
- **Phase 7+ target: Candidate 2.** When L09cap lands, replace Candidate 1's deterministic root with a capability-derived pointer. That achieves the full V1-C1 closure required for the cleanest Vu Level 1 claim.
- **Reject Candidates 3 and 4** for Tier 2.

This recommendation has the property the brief demands: it does not default-pick to keep moving — it explicitly identifies that the "clean V1-C1" answer depends on L09cap, and asks the maintainers to accept the interim ⚠️ marker on V1-C1 in exchange for shipping Vu Level 1 in 2027 rather than 2029+.

### Public interface (sketch)

```ts
// src/lib/services/blob-inventory.ts (FUTURE)

export type BlobInventory = {
	/** UUIDs of every blob this vault owns, encrypted at rest. */
	blobIds: readonly string[];
	/** Latest CRDT update index for fast resume. */
	latestCrdtIndex: bigint;
	/** Address of the NEXT inventory write (Candidate 1's rotation). */
	nextAddr: Uint8Array;
	/** Monotonic write counter (for client-side replay protection). */
	version: bigint;
};

export interface BlobInventoryService {
	/** Initial bootstrap: derive addr_0 from vaultKey + deviceSalt. */
	bootstrapAddress(vaultKey: Uint8Array, deviceSalt: Uint8Array): Uint8Array;
	/** Fetch the inventory at the given address; decrypt with vaultKey. */
	load(addr: Uint8Array): Promise<BlobInventory>;
	/** Write a new inventory at addr_{n+1}; returns the new address. */
	rotate(prev: BlobInventory, vaultKey: Uint8Array): Promise<Uint8Array>;
}
```

### Persistence

- **R2 layout change.** All references to `vaults/{accountId}/…` are replaced. Per-blob random UUIDs at `blobs/{uuid}.bin`. The inventory lives at `inv/{base32(addr)}.bin`.
- **D1 change.** `accounts.sequence_clock` and `sessions.sequence_clock` lose their role as cross-account-observable counters — they become client-internal-only (kept for replay protection within a single capability scope, never returned in API responses to non-owning observers).

### Server route contract (proposed shape; see §L09cap for capability format)

- `GET /api/v2/blobs/{uuid}` — body-less; capability in header. Returns ciphertext.
- `PUT /api/v2/blobs/{uuid}` — body is ciphertext + nonce; capability in header.
- `DELETE /api/v2/blobs/{uuid}` — capability in header.
- `GET /api/v2/inv/{addr}` / `PUT /api/v2/inv/{addr}` — same shape, but the address is the inventory pointer rather than a blob UUID.

Routes deliberately under `/api/v2/` so they coexist with the Vu Level 2 `/api/blobs/*` and `/api/documents/[blobId]` routes during the migration window.

### Threat model delta vs L07a

| Threat | After L07a only (still Vu2) | After L07a + L07b (Vu1 candidate) |
| --- | --- | --- |
| Server sees per-account blob count | Yes — `vaults/{accountId}/crdt/*` enumerable | **No** (Cand. 1 ⚠ except first-pointer) / **No** (Cand. 2) |
| Server sees cross-account write ordering | Yes — `uploaded` timestamps within prefix | **No** — blob UUIDs are random |
| Server links two blob accesses to same user | Yes — same prefix | **No** under Cand. 2; ⚠ partial under Cand. 1 |
| Server can prove "user X ever existed" | Yes — `accounts.client_id` row | **No** under Cand. 2; ⚠ via deterministic bootstrap addr under Cand. 1 |

### Dependencies

- Variant (a) Candidate 1: no new dependencies. `@noble/hashes` HKDF already present.
- Variant (a) Candidate 2: depends on §L09cap (which itself depends on L09 AKD).
- Both: requires §L08 session-mint redesign first (otherwise the server still has `sessions.device_id` to correlate against).

### Integration points

- Replaces R2 key construction in `src/routes/api/blobs/upload/+server.ts`, `src/routes/api/blobs/latest/+server.ts`, `src/routes/api/documents/[blobId]/+server.ts`, and `src/lib/server/api/r2-gc.ts`.
- Client adds `src/lib/services/blob-inventory.ts` (see public interface).
- The existing v1 routes (`/api/blobs/*`, `/api/documents/*`) stay live for a migration window so older clients can still sync.

### Open issues

- **Sign-off required (B.1):** acceptance of Candidate 1's ⚠️ V1-C1 first-pointer observation as the Phase 4 minimum-viable, OR a directive to wait for Candidate 2 + L09cap before claiming Vu1.
- **GC reference-counting algorithm.** Without per-account prefix, GC must reconstruct the live set from each authenticated client's inventory on its next read. Spec the exact sweep frequency, the staleness window, and the failure-mode if a client never returns.
- **Migration window.** Dual-read shim that resolves both legacy `vaults/{accountId}/…` and new `blobs/{uuid}.bin` during the cutover. Need a deadline for the v1 routes to be removed.

---

## L08 — WebRTC + ECDH device pairing

> **Tier:** 2 — 2027
> **Standards:** WebRTC + RFC 7748 (X25519) + RFC 9381 (VRF for QR binding)

### Motivation

Today a new device must register via OPAQUE with the password and Secret Key. L08 lets an already-unlocked device pair a new device peer-to-peer over local WebRTC, with no server intermediation and QR-bound mutual auth.

### Public interface (sketch)

```ts
// src/lib/services/device-pairing.ts (FUTURE)

export interface PairingOffer {
	rtcSdp: string;
	pairingNonce: Uint8Array;        // 32 bytes, fresh
	qrCode: string;                  // base32 of the ECDH public key + nonce digest
}

export interface DevicePairingService {
	startAsHost(): Promise<PairingOffer>;             // existing device
	completeAsHost(answerSdp: string): Promise<void>; // existing device
	startAsGuest(offerQr: string): Promise<string>;   // new device, returns answerSdp
}
```

### Persistence

- D1 `device_pairings` table is already in `0001_init.sql` but unused. L08 wires it.
- IndexedDB on guest device gets a fresh `account` row whose `credentialId` is registered with the host's account in D1.

### Server route contract

L08 is server-free for the pairing transcript. Server is touched only for the post-pairing handshake that issues a fresh OPAQUE session token for the guest device (existing `/api/opaque/login/ke1`/`ke3` flow).

### Threat model delta

| Threat | Tier-1 today | Tier-2 with WebRTC |
| --- | --- | --- |
| Server learns device-set | Yes (sessions table) | Same; pairing itself is peer-to-peer but session minting still hits server |
| Hostile WiFi MITM during pairing | N/A | Defeated by QR-bound mutual ECDH auth |
| Lost QR code | N/A | Mitigated by single-use nonce + 60s TTL |

### Dependencies

- Browser WebRTC API (no library needed).
- QR code generator (no third-party origin — must render entirely client-side).

### Integration points

- Onboarding flow gains a "pair with another device" branch.
- New `src/lib/services/device-pairing.ts` host + guest implementations.

### Open issues

- NAT traversal without a STUN server — local-network case only at first.
- Guest device's Secret Key generation: derive from pairing ECDH or generate fresh?

---

## L08 — Session-mint redesign

> **Tier:** 2 — 2027 (lands with L08 pairing, in Phase 2 of the brief's plan)
> **Status:** **`awaiting Appendix B.2 sign-off`**
> **Closes:** [`VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md) **V1-C2** (no persistent device set).

### Motivation

L08 as originally specified (above) admits the gap explicitly: *"Server learns device-set: **Same**; pairing itself is peer-to-peer but session minting still hits server."* The current `sessions(token, account_id, device_id, expires_at, sequence_clock, created_at)` row plus the `accounts.last_login_at` bump per KE3 produce a server-visible "which devices logged in when, for which account" log — and that is precisely the V1-C2 blocker.

This sub-section specifies the redesign that eliminates that log. Two options were considered; **(ii) is recommended** for Phase 2.

### Option (i) — Stateless HPKE capability tokens

- Each authenticated request carries an HPKE-sealed capability derived from a long-lived group key shared with **L06 (MLS)**. The server verifies the capability per-request; no `sessions` row exists at all.
- The HPKE seal binds: (a) the request method + path, (b) a fresh client nonce, (c) the AKD epoch root.
- Server learns: nothing per-account, nothing per-device. Capabilities are single-use; replay attempts fail at nonce check.

**Pros:**
- Eliminates the `sessions` table entirely. V1-C2 is closed in the strongest possible sense.
- Composes cleanly with §L09cap and §L07b (Candidate 2): the same capability shape carries authentication AND routing.
- Provably Vu1, with an immediate path to Vu0.

**Cons:**
- Hard dependency on L06 (MLS) for the group key. L06 is Phase 5 in the brief's dependency graph — but L08 is Phase 2. Implementing (i) would require either shipping L06 before L08 (re-orders the graph) OR using a placeholder group key for L08-only (defeats the point).
- Higher per-request crypto cost (one HPKE seal/open per call).
- Higher rollout risk: a regression in HPKE state invalidates every session at once.

### Option (ii) — Unlinkable session-token rotation + column drops (RECOMMENDED)

- Drop `sessions.device_id` and `accounts.last_login_at` from the schema in `migrations/0004_metadata_minimization.sql`. They are simply gone; server cannot persist them.
- `sessions` keeps `(token, account_id, expires_at, sequence_clock)` only. **`device_id` and `last_login_at` cannot be re-introduced** — the audit-bindings guard added in the same migration rejects future migrations that attempt to add columns whose names match `/device|last_login|paired|fingerprint/i` on these tables.
- Tokens rotate aggressively: every authenticated request returns a fresh token in the response, and the old token is invalidated server-side. Two consecutive requests from the same client carry different tokens. The server still sees one `account_id` per session, but the per-session lifetime is bounded by the rotation window (default: every request, fall-back: every 60s).
- KE3 stops bumping `last_login_at`. The audit log line for "user logged in" is replaced by a `audit_events` row that records ONLY `(event_kind='login_completed', happened_at, anonymized_session_id)` — no `account_id`, no `device_id`.

**Pros:**
- No L06 dependency. Ships in Phase 2 immediately.
- Schema change is small, auditable, and rejects future regressions via the audit-bindings rule.
- Low rollout risk: token rotation is purely additive; old sessions remain valid until their TTL.

**Cons:**
- The `sessions.account_id` column still exists during a session's lifetime (so the server can route blob requests to the right R2 bucket — until §L07b lands and that bucket goes away). V1-C2 is **functionally** closed (no device set log), but the residual per-session `account_id` is acknowledged. Once §L07b lands, even `account_id` can be dropped or replaced with a capability scope.
- Not provably Vu0; option (i) is the long-term target.

### Trade-off table

| Property | (i) HPKE capability | (ii) Unlinkable rotation (RECOMMENDED) |
| --- | --- | --- |
| Per-account server fields after change | **NONE** (table removed) | `account_id` + short-lived `token` + `expires_at` + `sequence_clock` |
| `device_id` retained? | No (table gone) | **No (column dropped + guarded)** |
| `last_login_at` retained? | No (column gone) | **No (column dropped + guarded)** |
| L06 dependency | **YES (hard)** | No |
| Per-request latency cost | One HPKE seal/open | Same as today (D1 row lookup) |
| Schema-level guard against future drift | N/A (no schema) | **Yes (audit-bindings rule rejects re-adds)** |
| Rollout risk | High (single point of failure on HPKE state) | Low (incremental, feature-flag-able) |
| Closes V1-C2 | Yes (strongest sense) | **Yes (functional sense)** |
| Vu0-ready (no per-account row at all) | Yes | No — `account_id` remains until §L07b cuts it |
| Phase | Cannot ship before Phase 5 (L06) | **Ships in Phase 2** |

### Recommendation

**Adopt (ii) for Phase 2.** Adopt (i) as the Phase 7+ replacement once L06 is in place. The migration map's strict-subsumptive ladder allows this — (ii) closes V1-C2, and (i) later strengthens beyond Vu1 without trading anything away.

### Migration shape

Coordinates 1:1 with [`migrations/0004_metadata_minimization.sql`](../migrations/0004_metadata_minimization.sql) (drafted in Phase 1 §4.4, NOT applied):

| Table | Column | Action | Rationale |
| --- | --- | --- | --- |
| `sessions` | `device_id TEXT NOT NULL` | **DROP** | V1-C2 — eliminate device set log |
| `accounts` | `last_login_at INTEGER` | **DROP** | V1-C2 — eliminate per-account login timestamp |
| `device_pairings` | (entire table) | **DROP** | Never written to; future L08 pairing transcript is fully P2P and produces no server row |
| (new) | (audit-bindings guard) | **INSTALL** | Reject future `ALTER TABLE … ADD COLUMN` whose name matches `/device|last_login|paired|fingerprint/i` on `sessions` or `accounts` |

The down-migration restores the dropped columns (with `NULL` defaults) and removes the guard, so a rollback is safe within the rollout window.

### Audit-bindings rule (sketch)

Extend [`scripts/audit-bindings.mjs`](../scripts/audit-bindings.mjs) (or add a sibling `scripts/audit-metadata-minimization.mjs`) with a rule that:

1. Parses every `migrations/*.sql` in numeric order.
2. After applying `0004_metadata_minimization.sql`, the simulated schema MUST NOT contain `sessions.device_id`, `sessions.fingerprint*`, `accounts.last_login_at`, `accounts.paired_*`, etc.
3. The rule lists the forbidden column-name patterns explicitly: `/^device(?:_|$)/i`, `/^last_login/i`, `/^paired/i`, `/^fingerprint/i`.
4. CI runs this rule on every PR. A re-add fails the build.

### Public interface (sketch)

```ts
// src/lib/server/api/session-mint.ts (FUTURE — replaces parts of auth-token.ts)

export interface SessionMintResult {
	/** Short-lived bearer; rotated on every authenticated request. */
	token: string;
	/** Server time the token becomes invalid. ≤ 60 s typically. */
	expiresAt: number;
	/** New token returned in the response of the NEXT authenticated call. */
	nextRotation?: string;
}

export interface SessionMintService {
	/** Mint a fresh token post-KE3. Does NOT record device_id. */
	mintFromKE3(accountId: string, env: Env): Promise<SessionMintResult>;
	/** Rotate an existing token on a successful authenticated request. */
	rotate(currentToken: string, env: Env): Promise<SessionMintResult>;
	/** Revoke server-side on logout/lock. */
	revoke(token: string, env: Env): Promise<void>;
}
```

### Threat model delta

| Threat | Today (Vu2) | After §L08 redesign (Vu1 candidate) |
| --- | --- | --- |
| Server learns device set per account | **Yes** (`sessions.device_id` row per login) | **No** — column dropped, guard installed |
| Server learns login cadence per account | **Yes** (`accounts.last_login_at`) | **No** — column dropped |
| Server links two requests to same session | Yes (same `token`) | **Bounded** — `token` rotates per request; window ≤ 60s |
| Server links two sessions to same account | Yes (same `account_id`) | Yes, until §L07b lands. Acknowledged. |
| Server learns "this device just paired" | Yes (`device_pairings` row written) | **No** — table dropped; pairing is fully P2P |

### Dependencies

- No new external libraries.
- Coordinates with [`migrations/0004_metadata_minimization.sql`](../migrations/0004_metadata_minimization.sql) — schema migration.
- Coordinates with [`src/lib/server/api/auth-token.ts`](../src/lib/server/api/auth-token.ts) — `authenticate()` becomes a token-rotation entry point.
- Coordinates with [`src/routes/api/opaque/login/ke3/+server.ts`](../src/routes/api/opaque/login/ke3/+server.ts) — KE3 handler stops binding `device_id` and stops bumping `last_login_at`.
- Coordinates with [`src/routes/api/opaque/logout/+server.ts`](../src/routes/api/opaque/logout/+server.ts) — logout already exists; now also revokes any in-flight rotation token.

### Integration points

- Client (`src/lib/services/sync-client.ts`): each authenticated `fetch` reads the response's `next-token` header and stores it for the next request. Rotation is transparent to the rest of the client surface.
- Audit footer / lock screen: "Device set" claim in UI changes from "this device + paired devices" to "this device only." Marketing copy in [`src/lib/data/landing.ts`](../src/lib/data/landing.ts) and [`docs/PRIVACY-LEVEL.md`](./PRIVACY-LEVEL.md) "What is partial or pending" → moved out of pending once V1-C2 probe passes.

### Open issues

- **Sign-off required (B.2):** maintainer chooses (ii) for Phase 2 OR explicitly re-orders the dependency graph to put L06 before L08 and adopt (i).
- **Token rotation window default.** Per-request (strictest) vs 60s (operationally simpler). Default to per-request and degrade gracefully when network drops; reconsider if observed rotation churn proves expensive in D1 writes.
- **Audit-event row.** Whether to log `login_completed` at all in `audit_events`, or skip entirely. Defaulting to skip; record only error events. Worth one explicit discussion before Phase 2 lands.

---

## L09 — CONIKS-derived auditable key directory

> **Tier:** 2 — 2027
> **Standards:** [CONIKS](https://eprint.iacr.org/2014/1004), append-only Merkle log with VRF-based privacy

### Motivation

Today an attacker who compromises the server could swap a victim's OPAQUE envelope and offer a phished login flow. L09 publishes a Merkle commitment over every account's public material so any swap is visible to monitoring auditors.

### Public interface (sketch)

```ts
// src/lib/services/akd-monitor.ts (FUTURE)

export interface AkdEpoch {
	number: bigint;
	rootHash: Uint8Array;
	signedAt: number;
}

export interface AkdMonitor {
	currentEpoch(): Promise<AkdEpoch>;
	prove(clientId: string): Promise<{ leaf: Uint8Array; auditPath: Uint8Array[] }>;
	verifyProof(proof: { leaf: Uint8Array; auditPath: Uint8Array[] }, expected: AkdEpoch): Promise<boolean>;
}
```

### Persistence

- D1 `akd_epochs(number PRIMARY KEY, root_hash, signed_at)`.
- D1 `akd_leaves(client_id PRIMARY KEY, vrf_label, leaf_hash, epoch_number)`.
- Auditor archive published via Sigstore Rekor — same machinery as the bundle digest.

### Server route contract

- `GET /api/akd/epochs/latest` returns current root hash + signature
- `GET /api/akd/proofs/{clientId}` returns proof of inclusion
- Auditor harness runs as a GitHub Action that fetches and verifies the latest epoch on every release.

### Threat model delta

| Threat | Tier-1 today | Tier-2 with AKD |
| --- | --- | --- |
| Server silently swaps OPAQUE envelope | Possible, undetectable | Mitigated — any swap requires a new AKD leaf, which is monitored |
| Server forks AKD between users | N/A | Mitigated by Rekor anchoring |

### Dependencies

- A Merkle-tree library with audit-path generation (NOT in package.json today).
- VRF implementation. P256-VRF or Ed25519-VRF.

### Integration points

- `capabilities` endpoint flips `transparencyLog: true` once shipped.
- Client adds a startup check: fetch the latest AKD epoch, verify the included proof for the local account, refuse to unlock if proof mismatches.

### Open issues

- Auditor coordination. Who runs the third-party monitor? Initially we will, with public verification machinery.
- Privacy of the VRF labels. CONIKS uses VRF to hide which usernames exist; we need to choose between CONIKS-style VRF or Parakeet's signed-merkle-tree alternative.

---

## L09cap — Per-request unlinkable capability handles

> **Tier:** Vu0 track (Phase 7+ in the brief's plan).
> **Status:** `proposed` — **`awaiting Appendix B.3 sign-off`**. **Design only.** No implementation, no schedule, no claim of Vu0 until this sub-section is signed off in a separate review.
> **Closes:** [`VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md) **V0-C1** (unlinkable routing identifiers) and transitively **V0-C3** (no account-existence oracle). Also the cleanest answer to §L07b Candidate 2's "binds to L09cap" dependency.

### Hard stop

Per the migration brief §11: *"Do not implement L09cap, or claim Vu0, before the §4.3 sign-off."* This sub-section is the §4.3 deliverable. **No** `CURRENT_LEVEL` change to `1` is gated on it (Vu1 only requires V1-C1/C2/C3); **all** `CURRENT_LEVEL` changes to `0` are gated on it. The §L07b "Candidate 2" cleanup path also waits on it.

### Motivation

After Phase 4 L07b lands with Candidate 1 (deterministic-first-pointer), the only remaining Vu0 blocker on the API plane is the stable `accounts.client_id` that every OPAQUE handshake carries. The server can link `client_id` → all subsequent capabilities/requests by that account. Vu0 requires that the server cannot link requests to a stable per-account identifier.

L09 (above) anchors *public-key transparency* — the AKD publishes a Merkle root per epoch that proves the server hasn't silently swapped a victim's OPAQUE envelope. L09cap is the runtime complement: per-request, unlinkable capability handles that the server can verify against the published AKD epoch root **without** linking them to a stable per-account identifier.

### Candidate constructions

Two RFC-tracked patterns fit. The trade-off is along (a) anonymity model, (b) server-side cost, (c) post-quantum hardening path.

#### Candidate A — Privacy Pass (RFC 9576 / 9577 / 9578)

**Shape.** Server issues anonymous tokens to authenticated clients. Each token authorizes one privileged action (e.g., one R2 read). Tokens are unlinkable to each other and to the issuing transaction; the server cannot determine which client redeems which token, only that it was issued by a valid issuer.

**Mapping to V0-C1:**
- After successful OPAQUE login, the client requests N anonymous tokens (or refreshes them lazily). The token issue is the only step that carries `client_id`.
- Subsequent requests carry one token each (single-use). The server sees a stream of token redemptions; it cannot link them to a single account.
- Tokens are bound to the current AKD epoch — when a new epoch publishes, prior tokens become invalid; client refreshes.

**Pros:**
- RFC 9576/9577/9578 are IETF-tracked. Reference implementations exist for HTTP token bindings (RFC 9577) and BlindRSA issuance (RFC 9578).
- Established anonymity guarantees; widely deployed by Cloudflare's own Privacy Pass and Apple's Private Access Tokens.
- Per-request handle: small (≤ 200 bytes), cheap to verify (RSA / VOPRF eval).

**Cons:**
- BlindRSA (the issuance variant) is **not post-quantum hardened**. Tokens issued today are decryptable by a future quantum adversary, which weakens the harvest-now-decrypt-later promise the rest of the stack honors.
- IETF working draft for PQ-Privacy-Pass exists but is years away. Migrating from RSA to a PQ-blind-signature scheme requires re-issuing all tokens.
- Cloudflare-friendly (their stack uses it) but introduces a non-Noble dependency.

#### Candidate B — VOPRF (RFC 9497) — RECOMMENDED for `proposed` state

**Shape.** Server has a per-epoch secret. Client blinds an input (e.g., `accountSeed ⊕ epochRoot`), server evaluates VOPRF, client unblinds. The result is a deterministic-from-input handle that the server cannot link to the input.

**Mapping to V0-C1:**
- After successful OPAQUE login, the client computes `handle = VOPRF(epoch_secret, accountSeed)`. The server's `epoch_secret` is shared with the AKD; the AKD publishes its commitment.
- For each request, client supplies `handle`. The server can verify `handle` is a valid VOPRF output for the current epoch (using the public commitment) without linking it to `accountSeed`.
- The handle rotates per epoch automatically because `epoch_secret` rotates.

**Pros:**
- RFC 9497 supports multiple curves including post-quantum-friendly choices (e.g., evaluated via ML-KEM-encrypted blinds — research-grade today but a real PQ path exists).
- `@noble/curves` already in `package.json`. The OPRF primitives we use today in OPAQUE (RFC 9807) are the SAME primitives. **No new top-level dependency** for the ristretto255/SHA-512 suite.
- Cleanly composes with L07b Candidate 2: the same `handle` carries both authentication AND routing to the blob inventory.

**Cons:**
- Per-request server cost is one VOPRF evaluation (scalar mult). Higher than Privacy Pass token verification.
- Requires the server to commit to the per-epoch secret in the AKD (a small extension to L09's schema).

#### Candidate C — Oblivious Routing (Tor-style)

Not seriously considered. Three-hop oblivious routing is incompatible with single-origin Cloudflare deployment.

### Recommendation (proposed; awaits B.3 sign-off)

**Candidate B — VOPRF (RFC 9497).** Reasons:

1. **No new top-level dependency.** OPRF primitives are already in the bundle via OPAQUE.
2. **PQ-hardening story exists.** The Noble OPRF can be combined with ML-KEM-encrypted blinds when that pattern matures, without re-issuing handles.
3. **Composes with L07b Candidate 2.** One handle, two purposes (auth + routing).
4. **AKD binding is a tiny extension** — the per-epoch VOPRF secret commitment fits naturally alongside L09's existing `akd_epochs` table.

### Public interface (sketch — proposed, not implementation-ready)

```ts
// src/lib/services/l09cap.ts (PROPOSED — DO NOT IMPLEMENT until B.3 sign-off)

export interface L09Capability {
	/** VOPRF output: the handle the server sees on each request. */
	handle: Uint8Array;
	/** AKD epoch this handle is bound to. Invalidates on epoch rollover. */
	epoch: bigint;
	/** Client-side blind factor; kept secret until unblind. */
	blind?: Uint8Array;
}

export interface L09CapabilityService {
	/** Derive a fresh handle for the current AKD epoch. */
	derive(accountSeed: Uint8Array, epoch: bigint): Promise<L09Capability>;
	/** Verify the handle against the published per-epoch commitment. */
	verify(handle: Uint8Array, epoch: bigint, commitment: Uint8Array): boolean;
	/** Refresh when the AKD epoch advances. */
	rotate(prior: L09Capability, newEpoch: bigint): Promise<L09Capability>;
}
```

### Server route contract (proposed)

- All `/api/v2/blobs/{uuid}` and `/api/v2/inv/{addr}` routes (from §L07b) accept `L09Capability` in the `Authorization` header instead of the rotated bearer token from §L08-redesign Option (ii).
- A new `GET /api/akd/epochs/{n}/voprf-commitment` returns the per-epoch VOPRF public commitment, signed by the AKD anchor.
- No new D1 table beyond extending `akd_epochs` with a `voprf_commitment BLOB NOT NULL` column.

### Threat model delta vs L08-redesign (ii) + L07b Candidate 1

| Threat | After L08-redesign + L07b Cand. 1 (Vu1) | After + L09cap (Vu0 candidate) |
| --- | --- | --- |
| Server links two requests to same account via `account_id` | Yes (residual in `sessions.account_id`) | **No** — `account_id` replaced by per-epoch unlinkable handle |
| Server proves "user X ever existed" via stable `client_id` | Yes (registration-time stable) | **No** — registration produces an account seed; client_id becomes an epoch-bound handle |
| Account-existence oracle on `/api/opaque/login/ke1` | Yes (401 'unknown clientId') | **No** — KE1 path either becomes capability-issuance only, or returns identical 401/200 timing for both known and unknown handles |
| Server learns "this AKD epoch has N active users" | N/A | **Yes** — request volume per epoch is still observable. Acknowledged; this is a metadata-volume signal, not an identity-correlation signal. |

### Dependencies

- L09 AKD must be live (Phase 7+ in the brief).
- L07b Candidate 2 should land at the same time, or `account_id` remains as a residual.
- Audit firm should review the AKD↔VOPRF binding; this is a new cryptographic protocol pattern relative to today's stack.

### Integration points

- All routes shift from `Authorization: Bearer <token>` to `Authorization: Capability <epoch>.<handle>`.
- Client `sync-client.ts` derives the handle on each session start and rotates on epoch advance.
- `/api/capabilities` flips `unlinkableHandles: true` once shipped.

### Open issues

- **Sign-off required (B.3):** maintainer chooses Candidate B (VOPRF) OR directs evaluation of Candidate A (Privacy Pass) OR commissions a third-party crypto review before implementation begins. Per §11, no code lands until this is signed.
- **PQ-hardening path.** Whether to ship Vu0 with classical VOPRF and accept the harvest-now-decrypt-later risk on routing handles (handles do not encrypt content; the worst-case quantum exposure is *linkability*, not plaintext), or wait for a PQ-OPRF standard.
- **Account recovery without `client_id`.** Today's recovery flow looks the account up by `client_id`. Once that's gone, recovery needs a separate registration-time `recoverySeed` that derives recovery-only capabilities, distinct from the routing handles. Specify before implementing.
- **Hard stop on Vu0 claim until sign-off:** `CURRENT_LEVEL` cannot change to `0` regardless of probe results until B.3 is signed off **and** L09cap has shipped and the V0-C1 probe passes against a live preview deploy. The probe scaffold in [`scripts/release-probe-vu1.mjs`](../scripts/release-probe-vu1.mjs) author's the V0-C1 assertion as `expected-fail` precisely so we cannot accidentally claim Vu0 from green V1 results.

---

## L10 — PIR + unbalanced PSI breach checks

> **Tier:** 2 — 2027
> **Standards:** RFC 9497 (VOPRF), OPRF-PSI literature

### Motivation

Today "Have I Been Pwned" lookups require sending the password to a third party. L10 lets us answer "is this password in HIBP?" without revealing the password to anyone — including us.

### Public interface (sketch)

```ts
// src/lib/services/breach-check.ts (FUTURE)

export type BreachCheckResult = { breached: true; estimatedOccurrences: number } | { breached: false };

export interface BreachCheckService {
	check(password: string): Promise<BreachCheckResult>;
}
```

### Persistence

None on the client. The server side hosts a periodically-refreshed encoded HIBP corpus.

### Server route contract

- `POST /api/breach/oprf` perform a single VOPRF evaluation against the server's secret. Server learns: nothing useful (the input is blinded).

The corpus itself is published as a static artifact so a client can do a local PSI against the server-OPRF'd input.

### Threat model delta

| Threat | Tier-1 today | Tier-2 with PIR |
| --- | --- | --- |
| HIBP query leaks password to third party | Possible (we don't ship this feature today; weak/reused is local-only) | Defeated by VOPRF blinding |
| Server learns which passwords a user has | Same — we don't ship a server-side check today | Defeated by VOPRF |

### Dependencies

- A VOPRF library (could use `@noble/curves` primitives).
- HIBP corpus access and a periodic refresh pipeline.

### Integration points

- Health-buckets gains a "breached" category.
- New `src/lib/services/breach-check.ts` returns the typed result.

### Open issues

- Corpus update cadence — every release? every quarter?
- Bandwidth profile for the OPRF artifact.

---

## L11 — FROST t-of-n recovery

> **Tier:** 3 — 2028
> **Standards:** RFC 9591 (FROST threshold Schnorr signatures)

### Motivation

The Tier-1 local Recovery Envelope concentrates recovery power in a single Recovery Password. L11 splits that power across `n` parties with `t-of-n` threshold reconstruction, so:

- No single recoverer can recover unilaterally.
- The user picks recoverers from people they already trust (3 friends, 2 lawyers + 1 partner, etc.).
- Loss of any `n - t` recoverers is still recoverable.

### Public interface (sketch)

```ts
// src/lib/services/frost-recovery.ts (FUTURE)

export interface FrostShare {
	participantIndex: number;
	share: Uint8Array;          // sealed via per-recoverer X25519
	groupPublicKey: Uint8Array;
}

export interface FrostRecoveryService {
	distribute(t: number, n: number, recoverers: Recoverer[]): Promise<FrostShare[]>;
	requestRecovery(reason: string): Promise<RecoveryRequestId>;
	contributeSignature(requestId: RecoveryRequestId, share: FrostShare): Promise<void>;
	combine(requestId: RecoveryRequestId): Promise<Uint8Array>; // unwrapped vault key
}
```

### Persistence

- IndexedDB `frostShares` table on each recoverer's device.
- D1 `frost_recovery_requests(request_id PRIMARY KEY, account_id, threshold_t, threshold_n, status, created_at)`.
- D1 `frost_contributions(request_id, participant_index, contribution_blob, contributed_at, PRIMARY KEY(request_id, participant_index))`.

### Server route contract

The server is a coordinator only — it never sees the shares, only their ciphertexts.

- `POST /api/frost/requests` create a recovery request
- `POST /api/frost/requests/{id}/contribute` recoverer submits ciphertext share
- `GET /api/frost/requests/{id}` original user polls progress
- `POST /api/frost/requests/{id}/complete` original user marks complete and pulls all ciphertexts

### Threat model delta

| Threat | Tier-1 today | Tier-3 with FROST |
| --- | --- | --- |
| Single point of recovery failure (lost `.vukey`) | Yes | Defeated by `t-of-n` |
| Coerced recoverer | Single point of failure | Mitigated — needs `t` simultaneously |
| Server learns recovery threshold | N/A | Yes (server is coordinator); acceptable trade-off |

### Dependencies

- A FROST library — `@scure/frost` if it ships, or a hand-rolled implementation against `@noble/curves`.

### Integration points

- Onboarding gains a "set up recovery contacts" step.
- Replaces (or extends) the Tier-1 local Recovery Envelope.

### Open issues

- Trust model for recoverers: do they need a passkey, or can they be email-only?
- Pure-PQ variant (L18) eventually replaces this; designing the wire format with a swappable signature suite is critical.

---

## L12–L18 — Forward layers

These layers are documented at the same depth in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) §"Tier 3 — Recovery & autonomy" and §"Tier 4 — Frontier". They are deliberately NOT specified here because:

- **L12 TEE enclaves** depends on vendor attestation formats that are still moving.
- **L13 Noise-channel agentic autofill** depends on browser-extension API stability and the Noise IK pattern's adoption pace in the autofill ecosystem.
- **L14 FN-DSA** is gated on FIPS 206 finalizing (Aug 2025 draft).
- **L15 zkSNARK selective disclosure** is gated on a production-grade circuit framework reaching audit-ready status.
- **L16 drand timelock** has a viable spec today but depends on the drand network's continued operation.
- **L17 Threshold stateful HBS** depends on the Haystack reference implementation's production-readiness review.
- **L18 Pure-PQ threshold recovery** depends on RACCOON-style ML-DSA threshold signatures reaching standardization.

When any of those upstream dependencies move, a new section is added here BEFORE implementation begins, following the same template (motivation, primitives, public interface, persistence, route contract, threat-model delta, dependencies, integration points, open issues).

---

## Maintenance contract

- This file MUST NOT contain executable code that imports from `src/`. Auditors should be able to grep for "Tier 2" or "L0[6-9]" or "L1[0-8]" in the source tree and find zero results outside docs and UI labels.
- Each section's "Dependencies" line names every npm package required. The dependency must NOT be in `package.json` until the section is being implemented.
- The "Open issues" line is the queue of decisions that block implementation. When all open issues are resolved AND the dependency exists in `package.json`, that's the signal to move the section into a real implementation plan.

The Tier-1 release ships with this file present and these features absent. Any drift between this contract and `package.json` is a P1 finding for the next audit pass.
