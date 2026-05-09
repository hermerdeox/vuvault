<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { generateSecretKey, encodeBase32, groupChars } from '$lib/crypto/secret-key';
	import {
		PUBLIC_BUNDLE_HASH,
		PUBLIC_VAULT_VERSION,
		BUNDLE_HASH_SHORT
	} from '$lib/utils/env';
	import { IconArrowRight, IconArrowLeft, IconRefresh, IconDownload, IconPrint, IconKey } from '$lib/icons';

	// Format the canonical bundle hash for the human-readable Emergency
	// Kit (groups of 8) so it tracks every release rather than the
	// hardcoded placeholder the prototype shipped with.
	function chunk8(input: string): string[] {
		const out: string[] = [];
		for (let i = 0; i < input.length; i += 8) out.push(input.slice(i, i + 8));
		return out;
	}
	const bundleGroupedString = chunk8(PUBLIC_BUNDLE_HASH).join(' ');

	const ENTROPY_CELLS = 16;
	let entropyOn = $state(0);
	let bitsShown = $state(0);
	let generating = $state(false);
	let timestamp = $state<string>('awaiting generation…');

	const groups = $derived(onboarding.secretKeyEncoded ? groupChars(onboarding.secretKeyEncoded, 4) : []);

	async function generate() {
		generating = true;
		entropyOn = 0;
		bitsShown = 0;
		onboarding.secretConfirmed = false;
		onboarding.secretKey = null;
		onboarding.secretKeyEncoded = null;
		timestamp = 'generating…';

		// Animated entropy fill
		for (let i = 0; i < ENTROPY_CELLS; i++) {
			await new Promise((r) => setTimeout(r, 22));
			entropyOn = i + 1;
			bitsShown = (i + 1) * 16;
		}

		const bytes = generateSecretKey();
		onboarding.secretKey = bytes;
		onboarding.secretKeyEncoded = encodeBase32(bytes);
		timestamp = `generated ${new Date().toLocaleTimeString()}`;
		generating = false;
	}

	function downloadKit() {
		if (!onboarding.secretKeyEncoded) return;
		const content = `VuVault Emergency Kit
====================

Device: ${onboarding.deviceLabel || '(unnamed)'}
Issued: ${new Date().toISOString()}
Build:  v${PUBLIC_VAULT_VERSION}

Secret Key (256 bits, Base32-Crockford):
${groupChars(onboarding.secretKeyEncoded, 4).join(' ')}

Without this Secret Key AND access to a paired device,
your vault cannot be recovered. Print this. Keep it offline.

Bundle SHA-384 (verify against the published GitHub release):
${bundleGroupedString}
`;
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vuvault-emergency-kit-${Date.now()}.txt`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function downloadVuKey() {
		if (!onboarding.secretKeyEncoded) return;
		const payload = {
			format: 'vukey/v1',
			issued: new Date().toISOString(),
			device: onboarding.deviceLabel || null,
			secretKey: {
				encoding: 'base32-crockford',
				bits: 256,
				groups: groupChars(onboarding.secretKeyEncoded, 4),
				value: onboarding.secretKeyEncoded
			},
			build: {
				version: PUBLIC_VAULT_VERSION,
				bundleHash: PUBLIC_BUNDLE_HASH,
				bundleHashShort: BUNDLE_HASH_SHORT
			}
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vuvault-${Date.now()}.vukey`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function printKey() {
		if (!onboarding.secretKeyEncoded) return;
		const w = window.open('', '_blank', 'width=720,height=900');
		if (!w) return;
		const html = `<!doctype html><html><head><title>VuVault Secret Key</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#000;background:#fff;padding:32px;max-width:640px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{font-size:12px;color:#555;margin-bottom:28px}.key-box{border:2px solid #000;padding:18px 20px;border-radius:4px;margin-bottom:18px}.key{font-family:'Courier New',monospace;font-size:18px;font-weight:700;letter-spacing:1px;line-height:1.7;word-spacing:6px}.warn{border:1px solid #c00;padding:12px 16px;border-radius:4px;font-size:12px;color:#800;margin-bottom:18px}@media print{button{display:none}}</style>
</head><body>
<h1>VuVault Secret Key</h1><div class="sub">Print this and keep it offline.</div>
<div class="key-box"><div class="key">${groupChars(onboarding.secretKeyEncoded, 4).join(' &nbsp; ')}</div></div>
<div class="warn"><strong>⚠ Without this key</strong>, plus access to a paired device, your vault is permanently inaccessible.</div>
<button onclick="window.print()" style="padding:10px 20px;font-weight:600">Print this page</button>
</body></html>`;
		w.document.write(html);
		w.document.close();
		setTimeout(() => w.print(), 250);
	}

	function toggleConfirm(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		onboarding.secretConfirmed = target.checked;
	}

	$effect(() => {
		if (!onboarding.secretKey) generate();
	});
</script>

<section class="screen">
	<div class="screen-inner wide">
		<Eyebrow>Step 3 of 7 · Secret Key · 256 bits</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Your Secret Key. <span class="italic-serif">Generated here.</span>
		</h1>
		<p class="lede">
			256 bits of cryptographic entropy from your device's hardware random source. The server will
			never see this. Combined with your Touch ID, it's the only thing that can decrypt your vault.
		</p>

		<div class="secret-display">
			<div class="secret-label">
				<IconKey size={11} stroke={2} />
				Your Secret Key — never shared, never transmitted
			</div>
			<div class="secret-value">
				{#if groups.length}
					{#each groups as g, i (i)}
						<span class="grp">{g}</span>{' '}
					{/each}
				{:else}
					<span class="grp">────</span>
					<span class="grp">────</span>
					<span class="grp">────</span>
					<span class="grp">────</span>
				{/if}
			</div>
			<div class="entropy-meter">
				{#each Array(ENTROPY_CELLS) as _, i (i)}
					<div class="cell" class:on={i < entropyOn}></div>
				{/each}
			</div>
			<div class="meta">
				<div class="info">
					<span><strong>{bitsShown} bits</strong></span>
					<span><strong>crypto.getRandomValues</strong></span>
					<span><strong>{timestamp}</strong></span>
				</div>
				<div class="actions">
					<button class="action" disabled={!onboarding.secretKeyEncoded} onclick={downloadVuKey}>
						<IconKey size={12} stroke={1.8} />
						VuKey
					</button>
					<button class="action" disabled={!onboarding.secretKeyEncoded} onclick={printKey}>
						<IconPrint size={12} stroke={1.8} />
						Print
					</button>
				</div>
			</div>
		</div>

		<label class="confirm">
			<input
				type="checkbox"
				checked={onboarding.secretConfirmed}
				onchange={toggleConfirm}
				disabled={!onboarding.secretKeyEncoded}
			/>
			<div class="confirm-text">
				<strong>I've saved my Secret Key.</strong> I understand that without it, plus access to a
				paired device or the Emergency Kit, my vault is permanently inaccessible. VuVault cannot
				recover it for me — that's the whole point.
			</div>
		</label>

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
			<Button onclick={generate} disabled={generating}>
				<IconRefresh size={14} />
				Regenerate
			</Button>
			<Button onclick={downloadKit} disabled={!onboarding.secretKeyEncoded}>
				<IconDownload size={14} />
				Download Emergency Kit
			</Button>
			<Button
				variant="primary"
				size="lg"
				disabled={!onboarding.canAdvance}
				onclick={() => onboarding.next()}
			>
				Continue
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.secret-display {
		margin-bottom: 24px;
		padding: 24px;
		background: var(--bg-elev);
		border: 1px solid var(--accent);
		border-radius: var(--radius-lg);
		position: relative;
		overflow: hidden;
	}
	.secret-display::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
	}
	.secret-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		margin-bottom: 12px;
	}
	.secret-value {
		font-family: var(--font-mono);
		font-size: clamp(18px, 2.4vw, 26px);
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text);
		word-break: break-all;
		line-height: 1.4;
		user-select: all;
	}
	.grp {
		display: inline-block;
		padding: 2px 4px;
	}
	.grp:nth-child(odd) {
		color: var(--accent);
	}

	.entropy-meter {
		display: flex;
		gap: 2px;
		margin-top: 10px;
	}
	.cell {
		flex: 1;
		height: 4px;
		background: var(--text-4);
		border-radius: 1px;
		transition: var(--transition);
	}
	.cell.on {
		background: var(--success);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 24px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px dashed var(--border);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		align-items: center;
		justify-content: space-between;
	}
	.info {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		align-items: center;
	}
	.info strong {
		color: var(--text-2);
		font-weight: 500;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		background: var(--surface);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		transition: var(--transition);
	}
	.action:hover:not(:disabled) {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent);
	}
	.action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.confirm {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 20px;
		cursor: pointer;
		user-select: none;
		transition: var(--transition);
	}
	.confirm:hover {
		background: var(--surface-hover);
	}
	.confirm input {
		margin-top: 2px;
		appearance: none;
		width: 16px;
		height: 16px;
		border: 1.5px solid var(--border-strong);
		border-radius: 4px;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}
	.confirm input:checked {
		background: var(--accent);
		border-color: var(--accent);
	}
	.confirm input:checked::after {
		content: '';
		position: absolute;
		left: 4px;
		top: 1px;
		width: 5px;
		height: 9px;
		border: solid var(--bg);
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.confirm-text {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.confirm-text strong {
		color: var(--text);
		font-weight: 600;
	}
</style>
