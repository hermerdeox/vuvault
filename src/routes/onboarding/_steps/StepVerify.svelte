<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import {
		PUBLIC_BUNDLE_HASH,
		verifyBundleIntegrity,
		type BundleIntegrity
	} from '$lib/utils/env';
	import {
		IconArrowRight,
		IconArrowLeft,
		IconCheck,
		IconWarning
	} from '$lib/icons';

	const bundleGroups = (() => {
		const out: string[] = [];
		for (let i = 0; i < PUBLIC_BUNDLE_HASH.length; i += 8) {
			out.push(PUBLIC_BUNDLE_HASH.slice(i, i + 8));
		}
		return out;
	})();

	// Mirror the unlock screen: actually run the verifier, surface its
	// state in the pill instead of unconditionally claiming VERIFIED.
	let integrity = $state<BundleIntegrity | null>(null);

	onMount(async () => {
		integrity = await verifyBundleIntegrity();
	});

	const blockingState = $derived(
		integrity?.state === 'mismatch' || integrity?.state === 'unsupported'
	);

	// CTA + visual state are driven by the verifier result. We never
	// render a green VERIFIED label unless the in-page check actually
	// passed; placeholder (dev) and verified are forward-OK, mismatch /
	// unsupported block continuation.
	const pillVariant = $derived(
		integrity == null
			? 'pending'
			: integrity.state === 'verified'
				? 'verified'
				: integrity.state === 'placeholder'
					? 'placeholder'
					: integrity.state === 'unsupported'
						? 'unsupported'
						: 'mismatch'
	);
	const pillLabel = $derived(
		integrity == null
			? 'CHECKING…'
			: integrity.state === 'verified'
				? 'VERIFIED'
				: integrity.state === 'placeholder'
					? 'DEV BUILD · NOT VERIFIED'
					: integrity.state === 'unsupported'
						? 'VERIFY UNSUPPORTED'
						: 'MISMATCH'
	);
</script>

<section class="screen">
	<div class="screen-inner wide">
		<Eyebrow>{onboarding.stepLabel('verify')} · Verify what you're running</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Verify the build. <span class="italic-serif">Trust math, not us.</span>
		</h1>
		<p class="lede">
			Before you unlock anything sensitive, here's the bundle hash for the VuVault you're running.
			Compare it to the public release log on GitHub. If it matches, you know the code on this page
			is exactly what we published — no targeted backdoor, no silent update.
		</p>

		<div class="bundle" class:bundle-bad={blockingState}>
			<div class="bundle-head">
				<div class="bundle-title">Bundle SHA-384 — Sigstore Rekor entry</div>
				<span class="pill pill-{pillVariant}">
					{#if pillVariant === 'verified'}
						<IconCheck size={9} stroke={3} />
					{:else if pillVariant === 'mismatch' || pillVariant === 'unsupported'}
						<IconWarning size={10} stroke={2.4} />
					{/if}
					{pillLabel}
				</span>
			</div>
			<div class="bundle-hash">
				<span class="accent">{bundleGroups[0]}</span>
				{#each bundleGroups.slice(1) as g, i (i)}
					{g}
				{/each}
			</div>
			{#if integrity?.state === 'mismatch'}
				<div class="bundle-detail">
					Mismatch on <code>{integrity.mismatchedChunk ?? 'aggregate'}</code> —
					reload from the canonical origin and verify the published Rekor entry.
				</div>
			{:else if integrity?.state === 'unsupported'}
				<div class="bundle-detail">
					This runtime cannot compute SHA-384 in the browser. Use a current
					Chromium / Firefox / Safari build to verify the bundle.
				</div>
			{:else if integrity?.state === 'placeholder'}
				<div class="bundle-detail">
					Dev build · the placeholder hash above ships only in local dev.
					Production deploys recompute and bind a real bundle hash.
				</div>
			{/if}
		</div>

		<div class="grid">
			<div class="card">
				<div class="key">Device label</div>
				<div class="val">{onboarding.deviceLabel || '—'}</div>
			</div>
			<div class="card">
				<div class="key">Authenticator</div>
				<div class="val"><span class="ok">✓</span>Platform · WebAuthn PRF</div>
			</div>
			<div class="card">
				<div class="key">Secret Key</div>
				<div class="val"><span class="ok">✓</span>256 bits · device-only</div>
			</div>
			<div class="card">
				<div class="key">Vault cipher</div>
				<div class="val"><span class="ok">✓</span>ML-KEM-1024 + X25519 + AES-256-GCM</div>
			</div>
			<div class="card">
				<div class="key">Sync</div>
				<div class="val"><span class="ok">✓</span>Local-only · BYO storage planned (Tier 2)</div>
			</div>
			<div class="card">
				<div class="key">Telemetry</div>
				<div class="val" style="color: var(--success);">No analytics tags shipped</div>
			</div>
		</div>

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
			<Button href="https://github.com/vuvault/vuvault/releases">View public release</Button>
			<Button
				variant="primary"
				size="lg"
				disabled={blockingState}
				onclick={() => onboarding.next()}
			>
				Looks right, continue
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.bundle {
		padding: 18px 20px;
		background: var(--bg-elev);
		border: 1px solid var(--accent);
		border-radius: var(--radius-lg);
		margin-bottom: 24px;
	}
	.bundle.bundle-bad {
		border-color: var(--danger);
		background: color-mix(in srgb, var(--danger) 6%, var(--bg-elev));
	}
	.bundle-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.bundle-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.pill-verified {
		background: var(--success-dim);
		border-color: color-mix(in srgb, var(--success) 35%, transparent);
		color: var(--success);
	}
	.pill-placeholder {
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		color: var(--warn);
	}
	.pill-mismatch,
	.pill-unsupported {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border-color: color-mix(in srgb, var(--danger) 35%, transparent);
		color: var(--danger);
	}
	.bundle-detail {
		margin-top: 10px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		line-height: 1.5;
	}
	.bundle-detail code {
		font-family: inherit;
		color: var(--text-2);
	}
	.bundle-hash {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-2);
		word-break: break-all;
		line-height: 1.6;
		letter-spacing: 0.02em;
	}
	.bundle-hash .accent {
		color: var(--accent);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 20px;
	}
	@media (max-width: 45em) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.card {
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.key {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
	}
	.val {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text);
		word-break: break-all;
	}
	.ok {
		color: var(--success);
		margin-right: 6px;
	}
</style>
