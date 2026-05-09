<script lang="ts" module>
	// Module-level counter for SSR / non-crypto fallback id generation.
	// In the browser we always use crypto.randomUUID, so this only
	// matters on the server during prerender.
	let modalCounter = 0;
	export function nextModalCounter(): number {
		return ++modalCounter;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { IconClose } from '$lib/icons';

	type Props = {
		open: boolean;
		title?: string;
		onClose: () => void;
		size?: 'sm' | 'md' | 'lg';
		children: Snippet;
		footer?: Snippet;
	};

	let { open, title, onClose, size = 'md', children, footer }: Props = $props();

	let dialogEl: HTMLDivElement | null = $state(null);
	let prevActive: Element | null = null;

	// Per-instance ID so two simultaneous modals (rare today, common
	// once Milestone 2 adds confirmation dialogs over the editor)
	// don't collide on `id="modal-title"`. crypto.randomUUID is only
	// defined in browsers — fall back to a counter for SSR safety.
	const titleId = `modal-title-${
		typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : nextModalCounter()
	}`;

	$effect(() => {
		if (open) {
			prevActive = document.activeElement;
			// Focus the modal on next frame so internal autoFocus inputs can take over.
			queueMicrotask(() => {
				dialogEl?.focus();
			});
		} else if (prevActive instanceof HTMLElement) {
			prevActive.focus();
			prevActive = null;
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === 'Tab' && dialogEl) {
			const focusable = dialogEl.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	onMount(() => {
		// no-op — effect handles focus restore
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="backdrop" onclick={onBackdrop} role="presentation">
		<div
			bind:this={dialogEl}
			class="modal {size}"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
		>
			{#if title}
				<header class="head">
					<h2 id={titleId}>{title}</h2>
					<button class="close" onclick={onClose} aria-label="Close">
						<IconClose size={16} stroke={1.8} />
					</button>
				</header>
			{/if}
			<div class="body">
				{@render children()}
			</div>
			{#if footer}
				<footer class="foot">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		z-index: 100;
		padding: 24px;
	}
	.modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-height: calc(100dvh - 48px);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		outline: none;
	}
	.modal.sm {
		max-width: 420px;
	}
	.modal.md {
		max-width: 640px;
	}
	.modal.lg {
		max-width: 880px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	h2 {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text);
	}
	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
	}
	.close:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.body {
		padding: 20px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 20px;
		border-top: 1px solid var(--border);
		flex-shrink: 0;
		background: var(--surface);
	}
</style>
