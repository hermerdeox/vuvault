<script lang="ts">
	import { pwa } from '$lib/pwa/pwa.svelte';
	import { PUBLIC_VAULT_VERSION } from '$lib/utils/env';
</script>

{#if pwa.updateReady}
	<div class="update-toast" role="status" aria-live="polite">
		<div class="copy">
			<strong>Update ready.</strong>
			<span class="detail">
				{#if pwa.nextVersion && pwa.nextVersion !== 'dev'}
					v{PUBLIC_VAULT_VERSION} → v{pwa.nextVersion} · applies a new signed bundle
				{:else}
					A new signed bundle is available
				{/if}
			</span>
		</div>
		<div class="actions">
			<button class="apply" onclick={() => pwa.applyUpdate()}>Apply &amp; reload</button>
			<button class="later" onclick={() => pwa.dismissUpdate()}>Later</button>
		</div>
	</div>
{/if}

<style>
	.update-toast {
		position: fixed;
		z-index: 200;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(16px + env(safe-area-inset-bottom, 0px));
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: min(92vw, 560px);
		padding: 12px 14px 12px 18px;
		background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
	}
	.copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.copy strong {
		font-size: 13px;
		letter-spacing: -0.005em;
	}
	.detail {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.apply {
		padding: 8px 14px;
		font-size: 12px;
		font-weight: 700;
		color: var(--bg);
		background: var(--text);
		border-radius: 999px;
		transition: var(--transition);
	}
	.apply:hover {
		opacity: 0.85;
	}
	.later {
		padding: 8px 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
		border-radius: 999px;
		transition: var(--transition);
	}
	.later:hover {
		color: var(--text-2);
	}
	@media (max-width: 30em) {
		.update-toast {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			width: 92vw;
		}
		.actions {
			justify-content: flex-end;
		}
		.apply,
		.later {
			min-height: 44px;
		}
	}
</style>
