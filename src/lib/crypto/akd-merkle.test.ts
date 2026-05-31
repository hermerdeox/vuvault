/**
 * Unit tests for `akd-merkle.ts` — the AKD sparse Merkle tree.
 *
 * Contract under test:
 *   - buildMerkleRoot is deterministic regardless of leaf order.
 *   - The empty tree has the deterministic precomputed empty root.
 *   - buildInclusionProof + verifyInclusionProof round-trip for
 *     leaves in the set.
 *   - verifyInclusionProof rejects: tampered root, tampered leaf,
 *     tampered sibling, wrong position.
 *   - buildInclusionProof throws when the target leaf is not in the set.
 *   - Scales: tree with 1, 16, 100 leaves all build + verify.
 */

import { describe, expect, it } from 'vitest';
import { sha384 } from '@noble/hashes/sha2';
import {
	AKD_HASH_LEN,
	AKD_POS_BITS,
	buildMerkleRoot,
	buildInclusionProof,
	verifyInclusionProof,
	hashLeafContent,
	type AkdLeaf
} from './akd-merkle';

function makeLeaf(seed: number): AkdLeaf {
	const pos = sha384(new Uint8Array([seed & 0xff, 0xa1, (seed >> 8) & 0xff]));
	const hash = sha384(new Uint8Array([seed & 0xff, 0xb2, (seed >> 8) & 0xff]));
	return { pos, hash };
}

describe('akd-merkle · basics', () => {
	it('exports AKD_HASH_LEN = 48 and AKD_POS_BITS = 384 (SHA-384)', () => {
		expect(AKD_HASH_LEN).toBe(48);
		expect(AKD_POS_BITS).toBe(384);
	});

	it('buildMerkleRoot on empty leaves returns a 48-byte root', () => {
		const root = buildMerkleRoot([]);
		expect(root.length).toBe(AKD_HASH_LEN);
	});

	it('empty root is deterministic across calls', () => {
		const r1 = buildMerkleRoot([]);
		const r2 = buildMerkleRoot([]);
		expect(Array.from(r1)).toEqual(Array.from(r2));
	});

	it('single-leaf tree has a stable root', () => {
		const leaf = makeLeaf(1);
		const r1 = buildMerkleRoot([leaf]);
		const r2 = buildMerkleRoot([leaf]);
		expect(Array.from(r1)).toEqual(Array.from(r2));
		// Single-leaf root must NOT equal the empty root.
		const empty = buildMerkleRoot([]);
		expect(Array.from(r1)).not.toEqual(Array.from(empty));
	});

	it('root is independent of leaf insertion order', () => {
		const leaves = [1, 2, 3, 4, 5].map(makeLeaf);
		const r1 = buildMerkleRoot(leaves);
		const reordered = [...leaves].reverse();
		const r2 = buildMerkleRoot(reordered);
		expect(Array.from(r1)).toEqual(Array.from(r2));
	});

	it('hashLeafContent is SHA-384', () => {
		const input = new TextEncoder().encode('test');
		const out = hashLeafContent(input);
		const expected = sha384(input);
		expect(Array.from(out)).toEqual(Array.from(expected));
	});
});

describe('akd-merkle · inclusion proofs', () => {
	it('round-trips for a single-leaf tree', () => {
		const leaf = makeLeaf(42);
		const root = buildMerkleRoot([leaf]);
		const proof = buildInclusionProof([leaf], leaf);
		expect(proof.siblings.length).toBe(AKD_POS_BITS);
		expect(verifyInclusionProof(root, proof)).toBe(true);
	});

	it('round-trips for a 16-leaf tree, every leaf', () => {
		const leaves = Array.from({ length: 16 }, (_, i) => makeLeaf(i));
		const root = buildMerkleRoot(leaves);
		for (const leaf of leaves) {
			const proof = buildInclusionProof(leaves, leaf);
			expect(verifyInclusionProof(root, proof)).toBe(true);
		}
	});

	it('round-trips for a 100-leaf tree (sample 5 random)', () => {
		const leaves = Array.from({ length: 100 }, (_, i) => makeLeaf(i + 1000));
		const root = buildMerkleRoot(leaves);
		const sample = [0, 17, 42, 73, 99];
		for (const idx of sample) {
			const proof = buildInclusionProof(leaves, leaves[idx]!);
			expect(verifyInclusionProof(root, proof)).toBe(true);
		}
	});

	it('throws when building a proof for a leaf NOT in the set', () => {
		const leaves = [makeLeaf(1), makeLeaf(2), makeLeaf(3)];
		const missing = makeLeaf(99);
		expect(() => buildInclusionProof(leaves, missing)).toThrow(/not in the set/);
	});
});

describe('akd-merkle · proof tampering rejects', () => {
	function setupTrio() {
		const leaves = [makeLeaf(10), makeLeaf(11), makeLeaf(12)];
		const root = buildMerkleRoot(leaves);
		const proof = buildInclusionProof(leaves, leaves[1]!);
		return { leaves, root, proof };
	}

	it('rejects a single-bit flip in the claimed root', () => {
		const { root, proof } = setupTrio();
		const tampered = new Uint8Array(root);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(verifyInclusionProof(tampered, proof)).toBe(false);
	});

	it('rejects a single-bit flip in the leaf hash', () => {
		const { root, proof } = setupTrio();
		const tamperedLeaf = new Uint8Array(proof.leafHash);
		tamperedLeaf[0] = (tamperedLeaf[0]! ^ 1) & 0xff;
		expect(verifyInclusionProof(root, { ...proof, leafHash: tamperedLeaf })).toBe(false);
	});

	it('rejects a tampered sibling', () => {
		const { root, proof } = setupTrio();
		const siblings = proof.siblings.map((s) => new Uint8Array(s));
		siblings[10]![0] = (siblings[10]![0]! ^ 1) & 0xff;
		expect(verifyInclusionProof(root, { ...proof, siblings })).toBe(false);
	});

	it('rejects a wrong position for a real leaf hash', () => {
		const { leaves, root, proof } = setupTrio();
		// Swap the position to that of a sibling leaf — the path
		// reconstruction yields a different root because the bit
		// pattern that picks left/right at each level differs.
		const wrongPos = leaves[2]!.pos;
		expect(verifyInclusionProof(root, { ...proof, pos: wrongPos })).toBe(false);
	});

	it('rejects malformed lengths without throwing', () => {
		const { root, proof } = setupTrio();
		expect(verifyInclusionProof(new Uint8Array(47), proof)).toBe(false);
		expect(
			verifyInclusionProof(root, { ...proof, leafHash: new Uint8Array(47) })
		).toBe(false);
		expect(
			verifyInclusionProof(root, {
				...proof,
				siblings: proof.siblings.slice(0, 100)
			})
		).toBe(false);
	});
});

describe('akd-merkle · privacy properties', () => {
	it('the empty tree root does not equal any non-empty tree root', () => {
		const empty = buildMerkleRoot([]);
		for (let i = 0; i < 8; i++) {
			const root = buildMerkleRoot([makeLeaf(i)]);
			expect(Array.from(root)).not.toEqual(Array.from(empty));
		}
	});

	it('adding a leaf changes the root', () => {
		const seed = [makeLeaf(1), makeLeaf(2)];
		const r1 = buildMerkleRoot(seed);
		const r2 = buildMerkleRoot([...seed, makeLeaf(3)]);
		expect(Array.from(r1)).not.toEqual(Array.from(r2));
	});
});
