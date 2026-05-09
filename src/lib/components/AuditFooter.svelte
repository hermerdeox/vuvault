<script lang="ts">
	import { audit } from '$lib/stores/audit.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { PUBLIC_BUNDLE_HASH } from '$lib/utils/env';
	import { isSyncWired } from '$lib/services/sync-client';

	type Props = {
		fallback?: string;
	};

	let { fallback = 'Vault sealed · all operations local' }: Props = $props();

	const message = $derived(audit.latest?.message ?? fallback);
	const level = $derived(audit.latest?.level ?? 'info');

	const bundleShort = PUBLIC_BUNDLE_HASH.slice(0, 8);
	const bytes = $derived(audit.bytesSent);
	const vaultKB = $derived(Math.max(audit.vaultSizeBytes / 1024, 0).toFixed(1));

	// Until sync ships (M3) the byte counter has nothing to count, so
	// rendering it as `0 B sent` is a defensible-but-worthless claim that
	// the user could easily misread as real-time confirmation. Show
	// "Local-only" instead until isSyncWired() flips, then expose the
	// counter once there is an actual cross-origin transfer to measure.
	const syncWired = isSyncWired();

	// ZK status comes from the vault store: while a vault is unlocked we
	// hold cleartext in memory, so the precise label is "ZK active";
	// when locked we are at "Sealed". The label is the runtime grounding
	// for the marketing line "ZK is *mechanically* verified, not asserted."
	const zkLabel = $derived(
		vault.status === 'unlocked'
			? 'ZK active'
			: vault.status === 'unlocking'
				? 'Unlocking…'
				: vault.status === 'error'
					? 'ZK error'
					: 'Sealed'
	);
</script>

<footer class="footer">
	<div class="feed">
		<span class="dot {level}" aria-hidden="true"></span>
		<span class="text">{message}</span>
	</div>
	<div class="stats">
		<div class="stat">
			<span class="key">Vault</span>
			<span class="val">{vaultKB} KB</span>
		</div>
		<div class="stat">
			<span class="key">Net</span>
			{#if syncWired}
				<span class="val accent">{bytes} B sent</span>
			{:else}
				<span class="val accent">Local-only</span>
			{/if}
		</div>
		<div class="stat">
			<span class="key">ZK</span>
			<span class="val" class:val-good={zkLabel === 'ZK active' || zkLabel === 'Sealed'}>
				{zkLabel}
			</span>
		</div>
		<div class="stat">
			<span class="key">Build</span>
			<span class="val">{bundleShort}</span>
		</div>
	</div>
	<div class="suite">
		<span class="tag">Your data. Your device. Your control.</span>
	</div>
</footer>

<style>
	.footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 30;
		height: var(--footer-h);
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 0 24px;
		gap: 16px;
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		border-top: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		letter-spacing: 0;
	}
	.feed {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
		flex-shrink: 0;
		animation: pulse 2.4s ease-in-out infinite;
	}
	.dot.warn {
		background: var(--warn);
	}
	.dot.danger {
		background: var(--danger);
	}
	.dot.info {
		background: var(--accent);
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
	.text {
		color: var(--text-2);
	}

	.stats {
		display: flex;
		gap: 16px;
		justify-content: center;
	}
	@media (max-width: 880px) {
		.stats {
			display: none;
		}
	}
	.stat {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.key {
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 10px;
		font-weight: 600;
	}
	.val {
		color: var(--text-2);
	}
	.val.accent {
		color: var(--accent);
	}
	.val.val-good {
		color: var(--success);
	}

	.suite {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}
	@media (max-width: 720px) {
		.suite {
			display: none;
		}
	}
	.tag {
		font-style: italic;
		font-family: var(--font-serif);
		font-size: 12px;
		color: var(--text-2);
	}
</style>
