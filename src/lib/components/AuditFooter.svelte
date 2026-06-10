<script lang="ts">
	import { audit } from '$lib/stores/audit.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { PUBLIC_BUNDLE_HASH } from '$lib/utils/env';
	import { isSyncWired } from '$lib/services/sync-client';
	import { CURRENT_LEVEL, currentLevel } from '$lib/data/privacy-level';

	type Props = {
		fallback?: string;
	};

	let { fallback = 'Vault sealed · all operations local' }: Props = $props();

	const message = $derived(audit.latest?.message ?? fallback);
	const level = $derived(audit.latest?.level ?? 'info');

	const bundleShort = PUBLIC_BUNDLE_HASH.slice(0, 8);
	const bytes = $derived(audit.bytesSent);
	const vaultKB = $derived(Math.max(audit.vaultSizeBytes / 1024, 0).toFixed(1));
	const syncWired = isSyncWired();
	const netLabel = $derived.by(() => {
		switch (vault.syncStatus) {
			case 'ready':
				return syncWired ? `Sync ready · ${bytes} B sent` : 'Sync ready';
			case 'syncing':
				return 'Syncing';
			case 'synced':
				return syncWired ? `Synced · ${bytes} B sent` : 'Synced';
			case 'failed':
				return 'Sync failed';
			case 'no-session':
				return 'No session';
			case 'local-only':
				return 'Local-only';
		}
	});
	const netTitle = $derived(vault.syncMessage);

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

	const privacyLevel = currentLevel();
	const privacyTitle = `${privacyLevel.short} · ${privacyLevel.headline}. Click for the honest evidence map.`;
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
			<span class="val accent" title={netTitle}>{netLabel}</span>
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
		<a
			class="level-badge"
			href="/privacy"
			title={privacyTitle}
			data-testid="privacy-level-badge"
			aria-label={privacyTitle}
		>
			Vu Level {CURRENT_LEVEL}
		</a>
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
		height: calc(var(--footer-h) + var(--safe-bottom));
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 0 max(24px, var(--safe-right, 0px)) var(--safe-bottom)
			max(24px, var(--safe-left, 0px));
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
	@media (max-width: 45em) {
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

	.level-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-xs);
		padding: 4px 10px;
		transition: var(--transition);
		text-decoration: none;
	}
	.level-badge:hover {
		filter: brightness(1.08);
		text-decoration: none;
	}
	:global(html[data-vp~='mobile']) .level-badge,
	:global(html[data-vp~='tablet']) .level-badge {
		min-height: 28px;
		display: inline-flex;
		align-items: center;
	}
	/* Touch devices at any viewport width: lift toward the 44pt tap
	   floor (footer row height allows 40px without growing the bar). */
	@media (pointer: coarse) {
		/* html[data-vp] matches the same specificity tier as the 28px
		   mobile/tablet cap above; being later in the file, it wins. */
		:global(html[data-vp]) .level-badge {
			min-height: 44px;
			display: inline-flex;
			align-items: center;
		}
	}

	.suite {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 12px;
	}
	@media (max-width: 45em) {
		/* Drop the marketing tag on phones but keep the Vu Level
		   badge — it's the one affordance that links users to the
		   honest evidence map. */
		.suite .tag {
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
