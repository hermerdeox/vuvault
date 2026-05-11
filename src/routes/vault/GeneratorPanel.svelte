<script lang="ts">
	import { generate, entropyBits, type GeneratorOpts } from '$lib/crypto/passgen';
	import { IconRefresh, IconCheck, IconCopy } from '$lib/icons';

	type Props = {
		onUse: (password: string) => void;
		onCancel: () => void;
	};
	let { onUse, onCancel }: Props = $props();

	let length = $state(24);
	let lower = $state(true);
	let upper = $state(true);
	let digit = $state(true);
	let symbol = $state(true);
	let excludeAmbiguous = $state(false);

	const opts = $derived<GeneratorOpts>({
		length,
		lower,
		upper,
		digit,
		symbol,
		excludeAmbiguous
	});

	let password = $state('');
	let bits = $derived(entropyBits(opts));

	function regen() {
		try {
			password = generate(opts);
		} catch {
			password = '';
		}
	}

	$effect(() => {
		// Re-generate whenever opts change (read once via $derived to register deps)
		void opts;
		regen();
	});

	const band = $derived.by(() => {
		if (bits < 60) return 'low';
		if (bits < 80) return 'mid';
		return 'high';
	});

	function copyPassword() {
		if (!password) return;
		navigator.clipboard.writeText(password).catch(() => {});
	}
</script>

<div class="generator">
	<div class="output">
		<div class="password" class:empty={!password}>
			{password || 'enable at least one class'}
		</div>
		<div class="output-actions">
			<button class="ico-btn" onclick={regen} aria-label="Regenerate">
				<IconRefresh size={14} stroke={1.6} />
			</button>
			<button class="ico-btn" onclick={copyPassword} aria-label="Copy">
				<IconCopy size={14} stroke={1.6} />
			</button>
		</div>
	</div>

	<div class="meter band-{band}">
		<div class="meter-fill" style:width="{Math.min(100, (bits / 128) * 100)}%"></div>
	</div>
	<div class="meter-label band-{band}">
		{bits.toFixed(0)} bits
		<span class="muted">
			· {band === 'low' ? 'weak' : band === 'mid' ? 'fair' : 'strong'}
		</span>
	</div>

	<div class="controls">
		<label class="ctrl">
			<span class="lbl">Length <span class="num">{length}</span></span>
			<input type="range" min="8" max="64" bind:value={length} />
		</label>

		<div class="toggles">
			<label class="toggle"
				><input type="checkbox" bind:checked={lower} /><span>a–z</span></label
			>
			<label class="toggle"
				><input type="checkbox" bind:checked={upper} /><span>A–Z</span></label
			>
			<label class="toggle"
				><input type="checkbox" bind:checked={digit} /><span>0–9</span></label
			>
			<label class="toggle"
				><input type="checkbox" bind:checked={symbol} /><span>!@#</span></label
			>
			<label class="toggle"
				><input type="checkbox" bind:checked={excludeAmbiguous} /><span
					>no 0/O/1/l/I</span
				></label
			>
		</div>
	</div>

	<div class="actions">
		<button class="btn ghost" onclick={onCancel}>Cancel</button>
		<button class="btn primary" onclick={() => onUse(password)} disabled={!password}>
			<IconCheck size={14} stroke={2.2} />
			Use this password
		</button>
	</div>
</div>

<style>
	.generator {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.output {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: center;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.password {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 600;
		color: var(--accent);
		letter-spacing: 0.04em;
		word-break: break-all;
	}
	.password.empty {
		color: var(--text-3);
		font-weight: 400;
		font-size: 13px;
		font-style: italic;
	}
	.output-actions {
		display: flex;
		gap: 6px;
	}
	.ico-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
	}
	:global(html[data-vp~='mobile']) .ico-btn,
	:global(html[data-vp~='tablet']) .ico-btn {
		width: 44px;
		height: 44px;
	}
	.ico-btn:hover {
		background: var(--surface-hover);
		color: var(--text);
	}

	.meter {
		height: 6px;
		background: var(--surface-strong);
		border-radius: 999px;
		overflow: hidden;
	}
	.meter-fill {
		height: 100%;
		transition: var(--transition);
		border-radius: 999px;
	}
	.meter.band-low .meter-fill {
		background: var(--danger);
	}
	.meter.band-mid .meter-fill {
		background: var(--warn);
	}
	.meter.band-high .meter-fill {
		background: var(--accent);
	}
	.meter-label {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
	}
	.meter-label.band-low {
		color: var(--danger);
	}
	.meter-label.band-mid {
		color: var(--warn);
	}
	.meter-label.band-high {
		color: var(--accent);
	}
	.muted {
		color: var(--text-3);
		font-weight: 400;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ctrl {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lbl {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.num {
		font-size: 14px;
		color: var(--text);
		font-weight: 700;
		text-transform: none;
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}

	.toggles {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 11px;
		min-height: 32px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: var(--transition);
	}
	.toggle:has(input:checked) {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.toggle input {
		display: none;
	}
	:global(html[data-vp~='mobile']) .toggle,
	:global(html[data-vp~='tablet']) .toggle {
		min-height: 44px;
		padding: 10px 14px;
		font-size: 12px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 600;
		border-radius: var(--radius-sm);
		transition: var(--transition);
	}
	.btn.ghost {
		color: var(--text-3);
		background: transparent;
	}
	.btn.ghost:hover {
		color: var(--text);
		background: var(--surface);
	}
	.btn.primary {
		background: var(--accent);
		color: var(--bg);
	}
	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
