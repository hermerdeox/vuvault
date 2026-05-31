/**
 * AKD sparse Merkle tree over VRF-derived leaf positions.
 *
 * Used by §L09 AKD to commit to a set of `(leaf_pos, leaf_hash)`
 * pairs in a way that supports proof-of-inclusion and (eventually,
 * post-Vu0) proof-of-non-inclusion. Every position is a 48-byte
 * (384-bit) SHA-384 of the VRF output, and the tree's root is a
 * single 48-byte SHA-384 commitment.
 *
 * Implementation choice — naive Merkle vs sparse Merkle:
 *   - A naive binary Merkle (e.g., RFC 6962) over the LIST of
 *     leaves leaks the order in which they were inserted. For an
 *     AKD, that ordering is a side channel.
 *   - A sparse Merkle indexes leaves by position (the 384-bit VRF
 *     output digest), so the tree shape is canonical regardless of
 *     insertion order.
 *
 * Performance — naive sparse Merkle has 384 levels which is
 * impractical. We use a "compact sparse Merkle tree" with implicit
 * empty subtrees: each level's "empty hash" is precomputed; a leaf
 * is represented by its hash; any internal node with only one
 * non-empty descendant is represented by that descendant directly
 * (path compression). For N leaves the tree is O(N log N) in time
 * and O(N) in space.
 *
 * Proof shape:
 *   - For each level from leaf to root, the sibling hash (48 bytes).
 *   - 384 sibling entries total (one per bit of the position).
 *   - Verification re-derives the path from the leaf+position by
 *     iterating over the position's bits and combining with the
 *     siblings.
 *
 * We omit "compressed proof" optimizations (skipping empty siblings)
 * for simplicity — the proof always carries 384 sibling hashes. At
 * 48 bytes each that's ~18 KiB per proof, which is acceptable for
 * the audit / verification use case.
 */

import { sha384 } from '@noble/hashes/sha2';

export const AKD_HASH_LEN = 48; // SHA-384 = 48 bytes
export const AKD_POS_BITS = 384; // SHA-384 output length in bits

const ZERO_HASH = new Uint8Array(AKD_HASH_LEN); // 48 bytes of 0x00

/**
 * Precomputed "empty hash" per level. emptyHash[0] = ZERO_HASH;
 * emptyHash[N] = SHA384(emptyHash[N-1] || emptyHash[N-1]). The
 * Merkle root of a fully-empty tree at level N is `emptyHashes[N]`.
 *
 * We memoize on the module level since the values are deterministic.
 */
const EMPTY_HASHES: Uint8Array[] = (() => {
	const out: Uint8Array[] = [];
	out.push(ZERO_HASH);
	for (let level = 1; level <= AKD_POS_BITS; level++) {
		const prev = out[level - 1]!;
		const combined = new Uint8Array(prev.length * 2);
		combined.set(prev, 0);
		combined.set(prev, prev.length);
		out.push(sha384(combined));
	}
	return out;
})();

export type AkdLeaf = {
	pos: Uint8Array; // 48 bytes
	hash: Uint8Array; // 48 bytes
};

export type AkdProof = {
	pos: Uint8Array; // 48 bytes — claimed leaf position
	leafHash: Uint8Array; // 48 bytes — claimed leaf hash
	siblings: Uint8Array[]; // exactly AKD_POS_BITS entries, each 48 bytes
};

function assertHash(name: string, h: Uint8Array): void {
	if (h.length !== AKD_HASH_LEN) {
		throw new Error(`${name}: expected ${AKD_HASH_LEN} bytes, got ${h.length}`);
	}
}

function combine(left: Uint8Array, right: Uint8Array): Uint8Array {
	assertHash('combine.left', left);
	assertHash('combine.right', right);
	const buf = new Uint8Array(left.length + right.length);
	buf.set(left, 0);
	buf.set(right, left.length);
	return sha384(buf);
}

/**
 * Extract the bit at index `bit` from position `pos`. Bit 0 is the
 * most-significant bit of pos[0]; bit 383 is the least-significant
 * bit of pos[47]. (Big-endian traversal from root to leaf.)
 */
function bitAt(pos: Uint8Array, bit: number): 0 | 1 {
	const byte = pos[bit >> 3]!;
	const shift = 7 - (bit & 7);
	return ((byte >> shift) & 1) as 0 | 1;
}

/**
 * Build the sparse Merkle tree commitment for the given set of
 * leaves and return the root hash. Each leaf's position is 48
 * bytes; the tree has up to 2^384 positions. Empty subtrees are
 * implicit via the precomputed `EMPTY_HASHES`.
 *
 * Algorithm: recursive depth-first construction over the set of
 * NON-EMPTY positions. At each level we partition the leaves into
 * "left" (bit = 0) and "right" (bit = 1) subgroups, recurse on
 * each, and combine. If either subgroup is empty, we substitute
 * the precomputed empty hash for that level. If only ONE leaf
 * remains in the subtree, we short-circuit to its hash combined
 * with empty siblings down to the leaf level.
 *
 * Returns the 48-byte root hash.
 */
export function buildMerkleRoot(leaves: AkdLeaf[]): Uint8Array {
	for (const leaf of leaves) {
		assertHash(`leaf.pos`, leaf.pos);
		assertHash(`leaf.hash`, leaf.hash);
	}
	return buildAt(leaves, 0);
}

function buildAt(leaves: AkdLeaf[], depth: number): Uint8Array {
	if (leaves.length === 0) {
		return EMPTY_HASHES[AKD_POS_BITS - depth]!;
	}
	if (depth === AKD_POS_BITS) {
		// All bits consumed; we are at a leaf level. The single
		// remaining leaf's hash IS the subtree hash.
		if (leaves.length !== 1) {
			throw new Error(`buildAt: ${leaves.length} leaves collided at the same position`);
		}
		return leaves[0]!.hash;
	}
	if (leaves.length === 1) {
		// Path-compression: walk the single leaf down to its full
		// depth, combining with empty siblings at each remaining
		// level. Equivalent to recursing but avoids array churn.
		const leaf = leaves[0]!;
		let current = leaf.hash;
		for (let level = AKD_POS_BITS - 1; level >= depth; level--) {
			const empty = EMPTY_HASHES[AKD_POS_BITS - level - 1]!;
			const bit = bitAt(leaf.pos, level);
			current = bit === 0 ? combine(current, empty) : combine(empty, current);
		}
		return current;
	}
	const left: AkdLeaf[] = [];
	const right: AkdLeaf[] = [];
	for (const leaf of leaves) {
		if (bitAt(leaf.pos, depth) === 0) left.push(leaf);
		else right.push(leaf);
	}
	const leftHash = buildAt(left, depth + 1);
	const rightHash = buildAt(right, depth + 1);
	return combine(leftHash, rightHash);
}

/**
 * Build a proof of inclusion for `leaf` against the leaf set.
 * Returns the AKD_POS_BITS sibling hashes from leaf to root.
 *
 * The proof is independent of leaf ordering — the caller can
 * verify against `buildMerkleRoot(leaves)` without committing to
 * an insertion order.
 */
export function buildInclusionProof(
	leaves: AkdLeaf[],
	target: AkdLeaf
): AkdProof {
	assertHash('target.pos', target.pos);
	assertHash('target.hash', target.hash);
	const found = leaves.find(
		(l) =>
			constantTimeEq(l.pos, target.pos) && constantTimeEq(l.hash, target.hash)
	);
	if (!found) {
		throw new Error('buildInclusionProof: target leaf is not in the set');
	}
	const siblings: Uint8Array[] = [];
	let working = leaves;
	for (let depth = 0; depth < AKD_POS_BITS; depth++) {
		const left: AkdLeaf[] = [];
		const right: AkdLeaf[] = [];
		for (const leaf of working) {
			if (bitAt(leaf.pos, depth) === 0) left.push(leaf);
			else right.push(leaf);
		}
		const targetBit = bitAt(target.pos, depth);
		if (targetBit === 0) {
			siblings.push(buildAt(right, depth + 1));
			working = left;
		} else {
			siblings.push(buildAt(left, depth + 1));
			working = right;
		}
	}
	return { pos: target.pos, leafHash: target.hash, siblings };
}

/**
 * Verify an inclusion proof against a claimed root. The verifier
 * re-derives the path from leaf to root using the sibling hashes
 * supplied in the proof.
 *
 * Returns true iff the proof's leaf+siblings reconstruct the
 * provided root. Constant-time comparison guards against
 * leakage-via-early-return on partial mismatches.
 */
export function verifyInclusionProof(root: Uint8Array, proof: AkdProof): boolean {
	if (root.length !== AKD_HASH_LEN) return false;
	if (proof.pos.length !== AKD_HASH_LEN) return false;
	if (proof.leafHash.length !== AKD_HASH_LEN) return false;
	if (proof.siblings.length !== AKD_POS_BITS) return false;
	for (const s of proof.siblings) {
		if (s.length !== AKD_HASH_LEN) return false;
	}
	let current = proof.leafHash;
	for (let depth = AKD_POS_BITS - 1; depth >= 0; depth--) {
		const sibling = proof.siblings[depth]!;
		const bit = bitAt(proof.pos, depth);
		current = bit === 0 ? combine(current, sibling) : combine(sibling, current);
	}
	return constantTimeEq(current, root);
}

function constantTimeEq(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

/** Hash a leaf's content for the Merkle tree. The exact recipe
 * lives in `akd-server.ts` (combining account_handle + epoch_id +
 * account_state_root) but we expose a generic SHA-384 helper here
 * for tests and proof verifiers. */
export function hashLeafContent(input: Uint8Array): Uint8Array {
	return sha384(input);
}
