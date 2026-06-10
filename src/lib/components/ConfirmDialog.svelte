<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

	type Variant = 'default' | 'danger';

	type Props = {
		open: boolean;
		title: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: Variant;
		onConfirm: () => void;
		onCancel: () => void;
	};

	let {
		open,
		title,
		message,
		confirmLabel = 'OK',
		cancelLabel = 'Cancel',
		variant = 'default',
		onConfirm,
		onCancel
	}: Props = $props();

	function handleConfirm() {
		onConfirm();
	}
</script>

<Modal {open} {title} size="sm" onClose={onCancel}>
	{#if message}
		<p class="message">{message}</p>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={onCancel}>
			{cancelLabel}
		</Button>
		{#if variant === 'danger'}
			<button type="button" class="confirm-danger" onclick={handleConfirm}>
				{confirmLabel}
			</button>
		{:else}
			<Button variant="accent" size="sm" onclick={handleConfirm}>
				{confirmLabel}
			</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	.message {
		font-size: 14px;
		line-height: 1.55;
		color: var(--text-2);
		letter-spacing: -0.005em;
		white-space: pre-line;
	}

	/* Destructive confirm — uses semantic --danger token rather than --accent.
	   Button component doesn't ship a danger variant, so this is the local
	   variant aligned to that styling shape. */
	@media (pointer: coarse) {
		.confirm-danger {
			min-height: 44px;
		}
	}
	.confirm-danger {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		font-size: 12px;
		font-weight: 700;
		color: var(--bg);
		background: var(--danger);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		transition: var(--transition);
		cursor: pointer;
		white-space: nowrap;
	}
	.confirm-danger:hover {
		filter: brightness(1.08);
	}
	.confirm-danger:focus-visible {
		outline: 2px solid var(--danger);
		outline-offset: 2px;
	}
</style>
