<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'accent' | 'ghost' | 'subtle';
	type Size = 'sm' | 'md' | 'lg';

	type Props = {
		variant?: Variant;
		size?: Size;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		href?: string;
		ariaLabel?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	};

	let {
		variant = 'subtle',
		size = 'md',
		disabled = false,
		type = 'button',
		href,
		ariaLabel,
		onclick,
		children
	}: Props = $props();
</script>

{#if href}
	<a class="btn {variant} {size}" {href} aria-label={ariaLabel}>
		{@render children()}
	</a>
{:else}
	<button class="btn {variant} {size}" {type} {disabled} aria-label={ariaLabel} {onclick}>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text);
		font-weight: 600;
		transition: var(--transition);
		white-space: nowrap;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn.sm {
		padding: 8px 14px;
		font-size: 12px;
	}
	.btn.md {
		padding: 12px 20px;
		font-size: 14px;
	}
	.btn.lg {
		padding: 14px 28px;
		font-size: 15px;
	}

	.btn.primary {
		background: var(--brand);
		color: var(--bg);
		border-color: var(--brand);
		font-weight: 700;
	}
	.btn.primary:hover:not(:disabled) {
		transform: translateY(-1px);
	}
	.btn.accent {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
		font-weight: 700;
	}
	.btn.ghost {
		background: transparent;
		border-color: transparent;
		color: var(--text-3);
	}
	.btn.ghost:hover:not(:disabled) {
		color: var(--text-2);
		background: var(--surface);
	}
</style>
