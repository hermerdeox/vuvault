/**
 * In-process OPAQUE server (RFC 9807) for tests and Milestone 2 dev
 * provisioning.
 *
 * The real Cloudflare Worker server lands in Milestone 3; this module
 * exists to drive the SAME `OpaqueServerEngine` as the Worker, just
 * with an in-memory `Map`-backed `OpaqueStorage` adapter instead of
 * D1. Because the engine is the only crypto-touching code path,
 * tests that exercise the mock prove the wire compatibility with
 * the production Worker without any second copy of the protocol
 * logic.
 *
 * Threat-model note: this server intentionally has no rate limiting
 * and no persistence beyond a `Map`. It exists ONLY to exercise the
 * protocol locally. Don't ever import it from anything that talks to
 * a network.
 */

import {
	OpaqueServerEngine,
	type OpaqueStorage,
	type StoredAccount,
	type PendingRegistration,
	type PendingLogin,
	type ServerIdentity
} from '../../../functions/api/_shared/server-opaque';

import type {
	AccountId,
	ClientIdentifier,
	ServerIdentifier
} from '$lib/types/sync';
import type { OpaqueTransport } from './opaque-client';

/**
 * Map-backed `OpaqueStorage` adapter. Entirely in memory — no
 * persistence between test cases or between runs. The pending
 * tables intentionally never expire (test cases are millisecond-
 * scale).
 */
class InMemoryOpaqueStorage implements OpaqueStorage {
	private readonly accounts = new Map<ClientIdentifier, StoredAccount>();
	private readonly pendingRegs = new Map<string, PendingRegistration>();
	private readonly pendingLogins = new Map<string, PendingLogin>();

	async getAccount(clientId: ClientIdentifier): Promise<StoredAccount | null> {
		return this.accounts.get(clientId) ?? null;
	}
	async putAccount(clientId: ClientIdentifier, account: StoredAccount) {
		this.accounts.set(clientId, account);
	}
	async deleteAccount(clientId: ClientIdentifier) {
		this.accounts.delete(clientId);
	}

	async getPendingRegistration(requestId: string) {
		return this.pendingRegs.get(requestId) ?? null;
	}
	async putPendingRegistration(requestId: string, p: PendingRegistration) {
		this.pendingRegs.set(requestId, p);
	}
	async deletePendingRegistration(requestId: string) {
		this.pendingRegs.delete(requestId);
	}

	async getPendingLogin(requestId: string) {
		return this.pendingLogins.get(requestId) ?? null;
	}
	async putPendingLogin(requestId: string, p: PendingLogin) {
		this.pendingLogins.set(requestId, p);
	}
	async deletePendingLogin(requestId: string) {
		this.pendingLogins.delete(requestId);
	}

	wipeAccount(clientId: ClientIdentifier) {
		this.accounts.delete(clientId);
	}

	expirePending() {
		this.pendingRegs.clear();
		this.pendingLogins.clear();
	}
}

/**
 * The mock server, parameterized by `serverId` so tests and dev
 * builds use a stable transcript binding distinct from production.
 *
 * Each instance has its own long-lived server keypair (generated on
 * construction) and its own in-memory storage. Multiple instances
 * are isolated.
 */
export class MockOpaqueServer {
	readonly serverId: ServerIdentifier;
	private readonly engine: OpaqueServerEngine;
	private readonly storage: InMemoryOpaqueStorage;

	constructor(serverId: ServerIdentifier) {
		this.serverId = serverId;
		const { serverSecretKey, serverPublicKey } = OpaqueServerEngine.generateServerKeypair();
		const identity: ServerIdentity = {
			serverId,
			serverSecretKey,
			serverPublicKey
		};
		this.storage = new InMemoryOpaqueStorage();
		this.engine = new OpaqueServerEngine(identity, this.storage);
	}

	/**
	 * Bind this mock server to the `OpaqueTransport` interface so the
	 * high-level `register`/`login` flows in `opaque-client.ts` can
	 * drive it directly.
	 */
	asTransport(): OpaqueTransport {
		return {
			registerRequest: (clientId, request) =>
				this.engine.registerRequest(clientId, request),
			registerRecord: (clientId, requestId, record) =>
				this.engine.registerRecord(clientId, requestId, record),
			loginKE1: (clientId, ke1) => this.engine.loginKE1(clientId, ke1),
			loginKE3: (clientId, requestId, ke3) =>
				this.engine.loginKE3(clientId, requestId, ke3)
		};
	}

	registerRequest(clientId: ClientIdentifier, request: Uint8Array) {
		return this.engine.registerRequest(clientId, request);
	}
	registerRecord(
		clientId: ClientIdentifier,
		requestId: string,
		record: Uint8Array
	): Promise<{ accountId: AccountId }> {
		return this.engine.registerRecord(clientId, requestId, record);
	}
	loginKE1(clientId: ClientIdentifier, ke1Bytes: Uint8Array) {
		return this.engine.loginKE1(clientId, ke1Bytes);
	}
	loginKE3(
		clientId: ClientIdentifier,
		requestId: string,
		ke3: Uint8Array
	): Promise<{ accountId: AccountId }> {
		return this.engine.loginKE3(clientId, requestId, ke3);
	}

	/** Test helper — simulate "this account doesn't exist on the server". */
	wipeAccount(clientId: ClientIdentifier): void {
		this.storage.wipeAccount(clientId);
	}

	/** Test helper — simulate replay of an old registration completion. */
	expirePending(): void {
		this.storage.expirePending();
	}
}
