/**
 * Sync + account protocol types — wire format for the Cloudflare Worker
 * that backs OPAQUE registration/login and encrypted blob sync.
 *
 * Milestone 1 shipped these types as a contract; Milestone 3 now maps
 * them to SvelteKit/Cloudflare API routes under `src/routes/api/**`.
 *
 * Milestone 2 reshapes the OPAQUE vocabulary to match RFC 9807
 * exactly — `RegistrationRequest`, `RegistrationResponse`,
 * `RegistrationRecord`, `KE1`, `KE2`, `KE3`, plus a `serverIdentifier`
 * for transcript binding. The DeviceId / SequenceClock additions from
 * Milestone 1 hardening are preserved.
 *
 * `src/lib/services/mock-opaque-server.ts` remains as an in-process
 * test/dev implementation of the same OPAQUE server-side contract.
 */

export type AccountId = string; // server-assigned UUID

/**
 * The relying-party identity bound into the OPAQUE transcript. Per
 * RFC 9807 §6.1 this is hashed into both the envelope and the AKE
 * MACs, so a server impersonator cannot complete a successful login
 * even if they replay every wire byte. Must equal the WebAuthn
 * `rp.id` to keep both factors anchored to the same domain.
 */
export type ServerIdentifier = string;

/**
 * Optional client identity. RFC 9807 §6.1 lets the protocol bind a
 * stable client handle (e.g. an account email) into the transcript;
 * the server treats it as opaque. We default to the same string
 * the user types in onboarding (a random base64 token in M2).
 */
export type ClientIdentifier = string;

// --- OPAQUE registration (RFC 9807 §6.3) -----------------------------

export type OpaqueRegistrationRequest = {
	op: 'opaque-register-request';
	clientId: ClientIdentifier;
	/**
	 * Base64-encoded OPRF blinded element. The server can't recover
	 * the underlying password from this — that's the whole aPAKE point.
	 */
	request: string;
};

export type OpaqueRegistrationResponse = {
	op: 'opaque-register-response';
	requestId: string;
	/** Base64-encoded server response: evaluated OPRF + server pubkey. */
	response: string;
};

export type OpaqueRegistrationRecord = {
	op: 'opaque-register-record';
	requestId: string;
	clientId: ClientIdentifier;
	/**
	 * Base64-encoded `RegistrationRecord` per RFC 9807. The server
	 * stores this verbatim and re-emits it during login. It is NOT
	 * sufficient to decrypt anything offline — that's why aPAKE.
	 */
	record: string;
};

// --- OPAQUE login (RFC 9807 §6.4 — 3-pass AKE) -----------------------

export type OpaqueLoginKE1 = {
	op: 'opaque-login-ke1';
	clientId: ClientIdentifier;
	/** Base64-encoded KE1 = credential_request || client_nonce || client_keyshare. */
	ke1: string;
};

export type OpaqueLoginKE2 = {
	op: 'opaque-login-ke2';
	requestId: string;
	/** Base64-encoded KE2 = credential_response || server_nonce || server_keyshare || server_mac. */
	ke2: string;
};

export type OpaqueLoginKE3 = {
	op: 'opaque-login-ke3';
	clientId: ClientIdentifier;
	requestId: string;
	/** Base64-encoded KE3 = client_mac. Server verifies and emits accountId on success. */
	ke3: string;
};

export type OpaqueLoginResult = {
	requestId?: string;
	accountId: AccountId;
	token?: string;
	expiresAt?: number;
	sequenceClock?: SequenceClock;
};

export type OpaqueServerError = {
	error: 'unknown-client' | 'invalid-mac' | 'replay' | 'rate-limited' | 'server';
	code: number;
	hint?: string;
};

// --- Sync + device metadata (Milestone 1 hardening) ------------------

/**
 * A device-scoped identifier that survives `localStorage.clear()` only
 * by accident — it should be regenerated whenever the account is
 * provisioned or recovered. Used by the server to attribute writes
 * for last-write-wins ordering and (later) per-device sync logs.
 */
export type DeviceId = string;

/**
 * A monotonic per-device sequence counter. Each successful blob
 * upload from a device increments its own counter. The server keeps
 * the highest known sequence per (accountId, deviceId) and rejects
 * any upload whose `sequenceClock <= server.knownLatest`. This makes
 * "Tab A persists slowly while Tab B persists later from a different
 * device" deterministic instead of racing on `updatedAt`.
 *
 * Milestone 2 uses this as the basis for incremental sync; Milestone 3
 * may upgrade to a vector clock for true conflict detection across N
 * devices.
 */
export type SequenceClock = number;

export type SyncBlobUpload = {
	op: 'blob-upload';
	accountId: AccountId;
	deviceId: DeviceId;
	sequenceClock: SequenceClock;
	header: string; // base64
	nonce: string;
	ciphertext: string;
	updatedAt: number;
	formatVersion: number;
};

export type SyncBlobFetch = {
	op: 'blob-fetch';
	accountId: AccountId;
	deviceId: DeviceId;
	/** Only return if the latest blob's sequenceClock > this value. */
	sinceSequenceClock?: SequenceClock;
	/** Legacy ms-epoch fallback; servers MAY ignore. */
	since?: number;
};

export type SyncBlobResponse = {
	header: string;
	nonce: string;
	ciphertext: string;
	updatedAt: number;
	formatVersion: number;
	/** Identifies which device produced this blob version. */
	deviceId: DeviceId;
	/** Per-device sequence at the time of upload. */
	sequenceClock: SequenceClock;
};

export type ServerError = {
	error: string;
	code: number;
	hint?: string;
};

export type SyncCapabilities = {
	opaque: boolean;
	blobSync: boolean;
	deviceEnrollment: boolean;
	transparencyLog: boolean;
};
