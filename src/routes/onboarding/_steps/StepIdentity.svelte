<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { IconArrowRight, IconArrowLeft } from '$lib/icons';

	const suggestions = ['MacBook Pro', 'Work laptop', 'Home desktop', 'iPhone 16 Pro', 'Personal browser'];

	let inputRef: HTMLInputElement | undefined = $state();

	$effect(() => {
		// Autofocus pops the keyboard over half the screen on phones —
		// native apps let the user tap the field. Desktop keeps it.
		if (window.matchMedia('(pointer: coarse)').matches) return;
		setTimeout(() => inputRef?.focus(), 200);
	});

	function handleInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		onboarding.deviceLabel = target.value;
	}

	function pickSuggestion(s: string) {
		onboarding.deviceLabel = s;
		if (inputRef) inputRef.value = s;
		inputRef?.focus();
	}
</script>

<section class="screen">
	<div class="screen-inner">
		<Eyebrow>{onboarding.stepLabel('identity')} · Device label</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">Name <span class="italic-serif">this device.</span></h1>
		<p class="lede">
			For your eyes only — this label helps you tell your devices apart in the audit log. It's
			stored locally and never transmitted. Pick anything memorable.
		</p>

		<div class="field">
			<label class="field-label" for="device-label">Device label</label>
			<input
				bind:this={inputRef}
				class="field-input"
				type="text"
				id="device-label"
				maxlength="64"
				placeholder="e.g. MacBook Pro 16″"
				autocomplete="off"
				spellcheck="false"
				value={onboarding.deviceLabel}
				enterkeyhint="next"
				oninput={handleInput}
			/>
			<div class="field-hint">Local only · 0 bytes sent · max 64 characters</div>
			<div class="suggest">
				{#each suggestions as s (s)}
					<button class="chip" onclick={() => pickSuggestion(s)}>{s}</button>
				{/each}
			</div>
		</div>

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
			<Button variant="primary" size="lg" disabled={!onboarding.canAdvance} onclick={() => onboarding.next()}>
				Continue
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 24px;
	}
	.field-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.field-input {
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 15px;
		color: var(--text);
		transition: var(--transition);
	}
	.field-input:focus {
		border-color: var(--accent);
		background: var(--surface-hover);
	}
	.field-hint {
		font-size: 11px;
		color: var(--text-3);
		font-family: var(--font-mono);
		letter-spacing: 0;
	}
	.suggest {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.chip {
		padding: 5px 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-2);
		font-family: var(--font-mono);
		transition: var(--transition);
	}
	:global(html[data-vp~='mobile']) .chip,
	:global(html[data-vp~='tablet']) .chip {
		/* Bump the suggestion chips to a comfortable touch target on
		   mobile. Desktop stays compact so the 5-chip row sits next to
		   the input. */
		min-height: 44px;
		padding: 10px 16px;
		font-size: 13px;
	}
	.chip:hover {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
