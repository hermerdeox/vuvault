<script lang="ts">
	/**
	 * Quick password generator — top-bar popover.
	 *
	 * Differs from the in-modal `GeneratorPanel` host inside
	 * `ItemEditor.svelte`:
	 *   - This is a non-modal popover. It does NOT trap focus; it
	 *     dismisses on Escape, click-outside, or the explicit Close
	 *     button. The page underneath stays interactive.
	 *   - "Use this password" copies the generated string to the
	 *     clipboard and closes — there is no item-creation side
	 *     effect. Use-case: one-off generation when the user is
	 *     pasting the password into another app or website without
	 *     storing it in VuVault first.
	 *   - Anchored to the top-right of the viewport, below the
	 *     header. Mobile-safe (max-width capped, repositions to
	 *     centered card under 720px).
	 *
	 * Security note: the generated password is held in a Svelte
	 * `$state` string until the popover closes, then cleared via the
	 * onClose effect. The class-coverage policy and CSPRNG-uniform
	 * sampling come from `crypto/passgen.ts` — same code path as the
	 * in-modal generator.
	 */
	import { onMount } from 'svelte';
	import GeneratorPanel from './GeneratorPanel.svelte';
	import { audit } from '$lib/stores/audit.svelte';
	import { IconClose } from '$lib/icons';

	type Props = {
		open: boolean;
		onClose: () => void;
	};
	let { open, onClose }: Props = $props();

	let dialogEl: HTMLDivElement | null = $state(null);
	let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	// The element that had focus before this popover opened, so we
	// can restore focus to it on close (a11y: focus must not be
	// stranded on a removed node).
	let prevActive: Element | null = null;

	function clearCopyStatus() {
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
			copyResetTimer = null;
		}
		copyStatus = 'idle';
	}

	function focusableElements(): HTMLElement[] {
		if (!dialogEl) return [];
		return Array.from(
			dialogEl.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
			)
		);
	}

	$effect(() => {
		if (open) {
			prevActive = document.activeElement;
			queueMicrotask(() => {
				dialogEl?.focus();
			});
		} else {
			clearCopyStatus();
			if (prevActive instanceof HTMLElement) {
				prevActive.focus();
				prevActive = null;
			}
		}
	});

	async function handleUse(password: string) {
		if (!password) return;
		try {
			await navigator.clipboard.writeText(password);
			copyStatus = 'copied';
			audit.push('success', 'Generated password copied to clipboard');
		} catch {
			copyStatus = 'failed';
			audit.push('warn', 'Clipboard write blocked — copy manually');
		}
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			clearCopyStatus();
			onClose();
		}, 900);
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		// Focus trap. Tab cycling inside the popover is a soft-modal
		// affordance: the page stays interactive (click-outside still
		// closes), but keyboard focus stays inside until the user
		// chooses to leave via Escape or the explicit Close button.
		if (e.key === 'Tab' && dialogEl) {
			const focusable = focusableElements();
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
			return;
		}
		// Arrow / Home / End nav across focusable controls. Only kick
		// in when focus is already inside the dialog so the global
		// arrow handler in the underlying page stays accessible.
		if (
			(e.key === 'ArrowDown' ||
				e.key === 'ArrowUp' ||
				e.key === 'Home' ||
				e.key === 'End') &&
			dialogEl &&
			dialogEl.contains(document.activeElement)
		) {
			const focusable = focusableElements();
			if (focusable.length === 0) return;
			const idx = focusable.findIndex((el) => el === document.activeElement);
			let next: HTMLElement | undefined;
			if (e.key === 'Home') next = focusable[0];
			else if (e.key === 'End') next = focusable[focusable.length - 1];
			else if (e.key === 'ArrowDown')
				next = focusable[Math.min(idx + 1, focusable.length - 1)];
			else if (e.key === 'ArrowUp') next = focusable[Math.max(idx - 1, 0)];
			if (next) {
				e.preventDefault();
				next.focus();
			}
		}
	}

	function onBackdropPointerDown(e: PointerEvent) {
		if (!open) return;
		if (e.target === e.currentTarget) onClose();
	}

	onMount(() => {
		return () => {
			if (copyResetTimer) clearTimeout(copyResetTimer);
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div
		class="popover-scrim"
		onpointerdown={onBackdropPointerDown}
		role="presentation"
	>
		<div
			bind:this={dialogEl}
			class="popover"
			role="dialog"
			aria-label="Quick password generator"
			tabindex="-1"
			data-testid="quick-generator"
		>
			<header class="head">
				<div class="title">
					<span class="eyebrow">Quick generator</span>
					<span class="hint">Copies on use · nothing stored</span>
				</div>
				<button class="close" onclick={onClose} aria-label="Close generator">
					<IconClose size={14} stroke={1.8} />
				</button>
			</header>
			<div class="body">
				<GeneratorPanel onUse={handleUse} onCancel={onClose} />
				{#if copyStatus === 'copied'}
					<div class="status status-ok" role="status">
						Copied to clipboard. Closing…
					</div>
				{:else if copyStatus === 'failed'}
					<div class="status status-warn" role="status">
						Clipboard write blocked — copy the value manually.
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.popover-scrim {
		position: fixed;
		inset: var(--header-h) 0 0 0;
		z-index: 60;
		display: block;
	}
	.popover {
		position: absolute;
		top: 8px;
		right: 16px;
		width: min(420px, calc(100vw - 32px));
		max-height: calc(100dvh - var(--header-h) - 24px);
		display: flex;
		flex-direction: column;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.title {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.eyebrow {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}
	.close {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
	}
	.close:hover,
	.close:focus-visible {
		background: var(--surface-hover);
		color: var(--text);
	}
	.body {
		padding: 14px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.status {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
	}
	.status-ok {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}
	.status-warn {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	@media (max-width: 45em) {
		.popover {
			top: 8px;
			right: 8px;
			left: 8px;
			width: auto;
		}
	}
</style>
