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
		<span class="v-mark">V</span>
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
		height: var(--top-bar-h, 56px);
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		padding: 0 24px;
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
		display: grid;
		place-items: center;
		background: var(--surface-hover);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-weight: 800;
		font-size: 14px;
		color: var(--brand);
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

	@media (max-width: 880px) {
		.whitepaper {
			display: none;
		}
	}
</style>
