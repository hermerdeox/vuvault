# Phase 5 — openmls → WASM feasibility report (stop-and-ask)

**Date:** 2026-05-22
**Plan reference:** `vu1_implementation_phases_2-6_f7fe69f7.plan.md` Phase 5
**Brief authority:** Vu1 migration brief §0.7 (open decisions),
`docs/TIER2-ARCHITECTURE.md` §L07 MLS

## TL;DR — Phase 5 is paused pending maintainer decision

Per the plan's explicit Phase 5 instruction: *"evaluate Rust
openmls→WASM feasibility — (a) existing npm wrapper, (b) in-repo
wasm-pack build, or (c) document alternatives and stop-and-ask"* —
this report documents the feasibility evaluation and selects **(c)**.

The path forward needs a maintainer-level decision. **No code lands
in this session for Phase 5.**

## Option (a) — existing npm wrapper

### Finding

`npm view openmls` returns nothing (no official Rust-openmls npm
package). `npm search openmls` surfaces a single candidate:

| Package | Published | Maintainer | Adoption signal |
| --- | --- | --- | --- |
| `ping-openmls-sdk@0.6.5` | **2026-05-22** (today) | `gideon-amp` | one maintainer, < 24 hours old |

### Verdict

**Reject.** A privacy-critical app's MLS group encryption MUST NOT
ride on a < 24-hour-old, single-maintainer, zero-track-record
package. That fails our own `scripts/verify-pins.mjs` discipline
(which already flags "unaudited new runtime dep" for OPAQUE and
Argon2id; MLS is even higher-stakes than either of those) and it
fails the brief's §0.1 ("no assumptions").

If `ping-openmls-sdk` accumulates a year of production usage, two
independent maintainers, and a public audit, this option becomes
reconsiderable.

## Option (b) — in-repo wasm-pack build from openmls Rust source

### Finding

The local node_modules has no `wasm-pack` binary. The repo does not
currently ship a Rust toolchain. Bringing up wasm-pack +
openmls→WASM in-tree would require:

1. Adding a `rust-toolchain.toml` and a `Cargo.toml` for the wrapper.
2. Vendoring (or git-submoduling) `openmls` Rust source.
3. Authoring the WASM glue (which openmls API surface to expose,
   how to map ciphersuite IDs, how to handle persistence).
4. CI changes: install Rust toolchain + wasm-pack in the lint/test
   job; add reproducible-build verification for the WASM blob.
5. Sigstore-signing the WASM artifact alongside the existing JS
   bundle artifacts.
6. A bundle-size budget review (openmls WASM is ~1–2 MB compiled).

The brief's §0.3 ("test everything you write") would also require:

7. RFC 9420 test vectors integrated into vitest.
8. Property tests for post-removal forward secrecy.
9. Multi-client interop tests against a known-good MLS implementation.

### Verdict

**Out of scope for this session.** A faithful wasm-pack build of
openmls is a multi-PR effort that touches every layer (build, CI,
release, observability). It is appropriate for a dedicated MLS
feature stream, not a sub-task inside the Vu1 migration session.

### What would unblock option (b)

The plan/brief authors would need to authorize:

- A separate development stream (own branch, own milestone, own
  verification report) for "L07 MLS via Rust openmls→WASM."
- Allocate the bundle-size budget (current bundle aggregate is
  recorded in `.bundle-digest` for reproducibility; adding 1–2 MB
  WASM is a >5% increase and needs an explicit budget bump).
- Decide whether the WASM artifact is co-signed under the existing
  Sigstore identity or under its own identity.

These are policy decisions, not engineering ones — only the
maintainer can make them.

## Option (c) — document alternatives and stop-and-ask

### Selected.

The plan's explicit fallback. This document is the stop-and-ask
artifact.

### Alternatives the maintainer can choose from

| Option | What lands today | What the maintainer signs off on |
| --- | --- | --- |
| **C1 — Pure deferral** | Nothing for Phase 5. `docs/TIER2-ARCHITECTURE.md §L07` already specifies the MLS interface; that spec sits unimplemented until a dedicated MLS development stream opens. | A note that MLS is not on the V1 critical path (V1-C1/C2/C3 do not depend on it) and the level-flip can proceed without it. |
| **C2 — Vendored Rust toolchain + openmls** | Open a separate branch with the wasm-pack scaffolding (Cargo.toml + rust-toolchain.toml + a hello-world WASM module). Subsequent PRs add the openmls integration. | Bundle-size budget bump, Sigstore-signing strategy for the WASM artifact, CI toolchain addition. |
| **C3 — Wait for upstream npm** | Track public MLS implementations; reconsider option (a) in 6–12 months. | A calendar reminder + a written re-evaluation criteria (e.g., "1 year of production usage and a public audit"). |
| **C4 — Tier-2 boundary change** | Move L07 MLS from "Tier 2" to "Tier 3" in the roadmap, alongside L09 AKD. | Updates to `docs/ROADMAP.md`, `docs/TIER2-ARCHITECTURE.md` (move §L07 to a "Tier 3" section), and `docs/PRIVACY-LEVEL.md` (the level ladder does not change since neither V1 nor V0 closure depends on L07). |

### Default recommendation (informational only)

**C1 — Pure deferral** is the lowest-cost path that does not block
the Vu1 level flip. The L07 MLS spec already exists; the absence of
implementation is not a privacy regression (the project never claimed
MLS group encryption today). When the dedicated MLS stream opens,
C2 becomes the implementation path.

The maintainer should sign off on C1 (or C2/C3/C4) in a follow-up
message; this report is the input to that decision.

## Impact on the Vu1 level flip

**None.** V1-C1, V1-C2, V1-C3 close without MLS:

- V1-C1 closes via Phase 4 §L07b (per-blob random keys + client
  inventory). MLS is orthogonal.
- V1-C2 closes via Phase 2 §L08 session-mint redesign (already shipped
  this session — see `docs/verifications/2026-05-22-vu1-phase2.md`).
- V1-C3 closes via Phase 4 §L07b. MLS is orthogonal.

The Vu1 level flip in Phase 6 gates on V1-C1/V1-C2/V1-C3 probes,
none of which exercise MLS. Phase 5's deferral does NOT delay the
flip.

## Probe / artifact impact

The release probe (`scripts/release-probe-vu1.mjs`) has no V1-Cn or
V0-Cn criterion that tests MLS. Phase 5 deferral therefore does NOT
introduce any expected_fail for the Vu1/Vu0 gates. (The probe does
not yet ship an `mls_*` criterion; if the maintainer signs off on
C2, that's the moment a new criterion would be added.)
