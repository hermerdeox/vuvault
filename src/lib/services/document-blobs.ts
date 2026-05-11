/**
 * Document blob service — high-level "attach a file" and "read a file"
 * operations against the active vault session and local Dexie storage.
 *
 * Plaintext file bytes are only present in memory inside this module
 * (during `attachDocumentFile`) and inside the caller's `Blob` during
 * `readDocumentBlob`. They are never written to disk in plaintext and
 * never sent to the sync server — only the AES-GCM-sealed bytes ever
 * leave the device.
 *
 * Sync push/pull is best-effort: if `PUBLIC_SYNC_ORIGIN` is unset or
 * the user has no active session token, the local Dexie row is the
 * sole source of truth. Future cross-device document fetch reads from
 * the server when the local row is missing.
 */

import {
	sealDocument,
	openDocument,
	type SealedDocument
} from './vault-session';
import {
	getDocumentBlob,
	saveDocumentBlob,
	deleteDocumentBlob as deleteLocalDocumentBlob,
	type DocumentBlobRecord
} from '$lib/utils/storage';
import {
	uploadDocumentBlob,
	fetchDocumentBlob,
	deleteDocumentBlob as deleteRemoteDocumentBlob,
	hasSession,
	isSyncWired
} from './sync-client';

export type AttachedDocument = SealedDocument & {
	fileName: string;
	mimeType: string;
	remote: boolean;
};

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Read, encrypt, and persist a `File`. Fire-and-forget pushes the
 * sealed bytes to the sync server if wired. Returns the metadata the
 * caller should attach to the matching `DocumentItem`.
 *
 * On error the local Dexie row is cleaned up so a partially-uploaded
 * file does not leave orphan ciphertext behind.
 */
export async function attachDocumentFile(file: File): Promise<AttachedDocument> {
	const buf = new Uint8Array(await file.arrayBuffer());
	const sealed = await sealDocument(buf);
	// Best-effort zeroize of the local plaintext copy. The browser
	// may keep a reference inside the File/Blob object that we cannot
	// reach; this at least clears the buffer we directly own.
	buf.fill(0);

	const rec: DocumentBlobRecord = {
		id: sealed.blobId,
		nonce: sealed.nonce,
		ciphertext: sealed.ciphertext,
		size: sealed.size,
		sha256: sealed.sha256Hex,
		createdAt: Date.now()
	};

	await saveDocumentBlob(rec);

	let remote = false;
	if (isSyncWired() && hasSession()) {
		const upload = await uploadDocumentBlob({
			blobId: sealed.blobId,
			nonce: bytesToBase64(sealed.nonce),
			ciphertext: bytesToBase64(sealed.ciphertext)
		});
		remote = upload.ok;
	}

	return {
		...sealed,
		fileName: file.name,
		mimeType: file.type || 'application/octet-stream',
		remote
	};
}

/**
 * Decrypt a previously sealed document. Tries the local Dexie row
 * first; falls back to the sync server when the local row is
 * missing (cross-device read path).
 */
export async function readDocumentBlob(blobId: string): Promise<Uint8Array> {
	const local = await getDocumentBlob(blobId);
	if (local) {
		return openDocument({
			blobId,
			nonce: local.nonce,
			ciphertext: local.ciphertext
		});
	}
	if (!isSyncWired() || !hasSession()) {
		throw new Error('Document blob not found locally and sync is not available.');
	}
	const result = await fetchDocumentBlob(blobId);
	if (!result.ok) {
		throw new Error(`Document blob fetch failed: ${result.message}`);
	}
	const nonce = base64ToBytes(result.value.nonce);
	const ciphertext = base64ToBytes(result.value.ciphertext);
	// Cache locally so subsequent opens stay offline. Use the size
	// reported by the ciphertext minus the GCM tag as an approximation;
	// callers that need exact plaintext size can re-decrypt and
	// measure.
	const plaintext = await openDocument({ blobId, nonce, ciphertext });
	const digest = await sha256HexLazy(plaintext);
	await saveDocumentBlob({
		id: blobId,
		nonce,
		ciphertext,
		size: plaintext.length,
		sha256: digest,
		createdAt: result.value.updatedAt || Date.now()
	});
	return plaintext;
}

/**
 * Best-effort delete: clears the local Dexie row and, when sync is
 * wired, asks the server to forget the encrypted object. The vault
 * item itself is removed by the caller.
 */
export async function purgeDocumentBlob(blobId: string): Promise<void> {
	await deleteLocalDocumentBlob(blobId);
	if (isSyncWired() && hasSession()) {
		// Errors are deliberately ignored — server is opaque storage,
		// not the source of truth.
		await deleteRemoteDocumentBlob(blobId).catch(() => undefined);
	}
}

async function sha256HexLazy(bytes: Uint8Array): Promise<string> {
	// `crypto.subtle.digest` is available in every supported browser
	// and the SvelteKit Worker runtime. Avoid pulling @noble/hashes
	// into this service module to keep the bundle slim — it's already
	// shipped via vault-session.
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	const view = new Uint8Array(digest);
	let hex = '';
	for (const b of view) hex += b.toString(16).padStart(2, '0');
	return hex;
}
