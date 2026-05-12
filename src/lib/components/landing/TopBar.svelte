<script lang="ts">
	import AudienceToggle from './AudienceToggle.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { landing } from '$lib/stores/landing.svelte';

	function jumpToFinal() {
		landing.last();
	}
</script>

<header class="topbar">
	<div class="brand">
		<img
			class="v-mark"
			src="/icons/icon-48.png"
			srcset="/icons/icon-48.png 1x, /icons/icon-96.png 2x, /icons/icon-128.png 3x"
			alt="VuVault"
			width="28"
			height="28"
		/>
		<span class="brand-name">VuVault</span>
		<span class="brand-pill">v0 · 2030 stack</span>
	</div>

	<div></div>

	<div class="nav-actions">
		<AudienceToggle />
		<a href="/blueprint" class="lbtn whitepaper">Whitepaper</a>
		<button class="lbtn primary" onclick={jumpToFinal}>Start free</button>
		<ThemeToggle />
	</div>
</header>

<style>
	.topbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 50;
		height: calc(var(--top-bar-h, 56px) + env(safe-area-inset-top, 0px));
		padding-top: env(safe-area-inset-top, 0px);
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		/* Padding honors landscape-notch insets so the brand and CTAs
		   stay clear of the iPhone notch / Dynamic Island. */
		padding-left: max(24px, env(safe-area-inset-left, 0px));
		padding-right: max(24px, env(safe-area-inset-right, 0px));
		gap: 24px;
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.02em;
	}
	.v-mark {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		object-fit: contain;
	}
	.brand-pill {
		margin-left: 8px;
		padding: 3px 7px;
		font-size: 10px;
		font-weight: 600;
		color: var(--text-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.nav-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		transition: var(--transition);
		white-space: nowrap;
		cursor: pointer;
	}
	.lbtn:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.lbtn.primary {
		background: var(--brand);
		color: var(--bg);
		border-color: var(--brand);
		font-weight: 700;
	}
	.lbtn.primary:hover {
		transform: translateY(-1px);
	}

	@media (max-width: 45em) {
		.whitepaper {
			display: none;
		}
		/* The "v0 · 2030 stack" pill duplicates the brand spatial footprint
		   on a 360px header. Drop it on mobile; the V-mark + wordmark is
		   enough identity. */
		.brand-pill {
			display: none;
		}
		.nav-actions {
			gap: 6px;
		}
		.lbtn,
		.lbtn.primary {
			min-height: 44px;
			padding: 10px 14px;
		}
	}
	@media (max-width: 30em) {
		.topbar {
			padding-left: max(14px, env(safe-area-inset-left, 0px));
			padding-right: max(14px, env(safe-area-inset-right, 0px));
			gap: 12px;
		}
		/* On a true mobile (<=480px), the wordmark also crowds the
		   AudienceToggle + Start-free + ThemeToggle row. Keep only the
		   V-mark; the page title is still in the document <title>. */
		.brand-name {
			display: none;
		}
	}
</style>
