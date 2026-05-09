<script lang="ts">
	import { PUBLIC_BUNDLE_HASH, PUBLIC_VAULT_VERSION } from '$lib/utils/env';

	// Render the canonical bundle hash from $env in 8-char groups, three
	// groups per line, so the snippet always matches what `npm run build`
	// actually emitted. The version label tracks `PUBLIC_VAULT_VERSION`
	// rather than the hardcoded v0.4.2 the prototype shipped with.
	function chunk8(input: string): string[] {
		const out: string[] = [];
		for (let i = 0; i < input.length; i += 8) {
			out.push(input.slice(i, i + 8));
		}
		return out;
	}
	function rows3(groups: string[]): string[][] {
		const out: string[][] = [];
		for (let i = 0; i < groups.length; i += 3) {
			out.push(groups.slice(i, i + 3));
		}
		return out;
	}
	const trustRows = rows3(chunk8(PUBLIC_BUNDLE_HASH));
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow"><span class="dot"></span>Verify, don't trust</div>
		<h2 class="section-title">
			Don't take our word.<br />
			<span class="italic-serif muted">Take our hashes.</span>
		</h2>
		<p class="section-sub">
			Three independent ways to verify what's running on your device matches what we say is
			running. No incumbent ships any of these.
		</p>

		<div class="trust-grid">
			<div class="trust-card">
				<div class="trust-card-num">METHOD 01</div>
				<div class="trust-card-title">Reproducible builds</div>
				<div class="trust-card-body">
					Every release builds byte-for-byte identically from public source. The bundle
					hash appears in your unlock screen. Compare it to the GitHub release hash.
				</div>
				<div class="trust-snippet">
					<span class="key">SHA-384</span><br />
					{#each trustRows as row, ri (ri)}
						{#each row as g, gi (gi)}
							<span class:ok={ri === 0 && gi === 1}>{g}</span>{#if gi < row.length - 1}{' '}{/if}
						{/each}<br />
					{/each}
					<span class="ok">✓ matches release v{PUBLIC_VAULT_VERSION}</span>
				</div>
			</div>
			<div class="trust-card">
				<div class="trust-card-num">METHOD 02</div>
				<div class="trust-card-title">Sigstore transparency log</div>
				<div class="trust-card-body">
					Every release is signed and the signature is recorded in Rekor, a public
					append-only log. We cannot ship a backdoored release without it being publicly
					recorded — forever.
				</div>
				<div class="trust-snippet">
					<span class="key">rekor</span> entry <span class="key">a3f8</span>...<span
						class="key">e2c1</span
					><br />
					signed by <span class="key">vu-release-key</span><br />
					<span class="ok">✓ verified · 2026-04-28</span>
				</div>
			</div>
			<div class="trust-card">
				<div class="trust-card-num">METHOD 03</div>
				<div class="trust-card-title">Self-host the entire stack</div>
				<div class="trust-card-body">
					The sync server is ~300 lines of TypeScript on Cloudflare Workers + R2. Deploy it
					yourself in 5 minutes. Bring your own bucket. Trust nobody, including us.
				</div>
				<div class="trust-snippet">
					<span class="key">$</span> wrangler deploy<br />
					<span class="ok">✓</span> uploaded vuvault-sync<br />
					<span class="ok">✓</span> R2 bucket: <span class="key">vault-blobs</span>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.muted {
		color: var(--text-3);
	}

	.trust-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-top: 28px;
	}
	.trust-card {
		padding: 28px 26px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 14px;
		backdrop-filter: blur(12px);
	}
	.trust-card-num {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--accent);
		font-weight: 600;
		letter-spacing: 0.1em;
	}
	.trust-card-title {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--text);
	}
	.trust-card-body {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.55;
	}
	.trust-snippet {
		margin-top: auto;
		padding: 12px 14px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-2);
		letter-spacing: 0;
		line-height: 1.5;
		word-break: break-all;
	}
	.trust-snippet :global(.ok) {
		color: var(--success);
	}
	.trust-snippet :global(.key) {
		color: var(--accent);
	}

	@media (max-width: 880px) {
		.trust-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
