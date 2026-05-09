/**
 * Audit feed store — drives the persistent footer audit feed.
 *
 * Per VuVault's design, the footer always tells the user what's
 * happening: vault size, sync status, byte counter, active cipher
 * suite, and whether ZK-mode is mechanically active.
 *
 * Append-only at runtime. Cap to 50 entries.
 */

export type AuditEntry = {
	id: string;
	at: number; // ms epoch
	level: 'info' | 'success' | 'warn' | 'danger';
	message: string;
	context?: Record<string, string | number>;
};

const MAX_ENTRIES = 50;

function makeId(): string {
	return crypto.getRandomValues(new Uint32Array(2)).join('-');
}

class AuditState {
	entries = $state<AuditEntry[]>([]);
	bytesSent = $state(0);
	vaultSizeBytes = $state(0);
	lastSyncAt = $state<number | null>(null);

	latest = $derived<AuditEntry | null>(this.entries[0] ?? null);

	push(level: AuditEntry['level'], message: string, context?: AuditEntry['context']): void {
		const entry: AuditEntry = {
			id: makeId(),
			at: Date.now(),
			level,
			message,
			context
		};
		this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
	}

	noteSync(): void {
		this.lastSyncAt = Date.now();
		this.push('success', 'Vault synced', { bytes: 0 });
	}

	noteVaultSize(bytes: number): void {
		this.vaultSizeBytes = bytes;
	}

	clear(): void {
		this.entries = [];
	}
}

export const audit = new AuditState();
