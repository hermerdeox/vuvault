<script lang="ts">
	import {
		PUBLIC_BUNDLE_HASH,
		PUBLIC_VAULT_VERSION,
		BUNDLE_HASH_SHORT
	} from '$lib/utils/env';

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
	// Method 02's Rekor snippet uses the leading + trailing 4 chars of
	// the live bundle hash so the displayed prefix/suffix always
	// matches what cosign actually signed. The exact Rekor index is
	// per-release and lives in release-artifacts/.rekor-index — not
	// shipped in the bundle.
	const rekorPrefix = PUBLIC_BUNDLE_HASH.slice(0, 4);
	const rekorSuffix = PUBLIC_BUNDLE_HASH.slice(-4);
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
					<span data-vp-show="desktop"
						>Every release builds byte-for-byte identically from public source. The
						bundle hash appears in your unlock screen. Compare it to the GitHub
						release hash.</span
					>
					<span data-vp-show="mobile"
						>Bundle hash on every unlock screen. Compare to the GitHub release hash.</span
					>
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
					<span data-vp-show="desktop"
						>Every release is signed and the signature is recorded in Rekor, a
						public append-only log. We cannot ship a backdoored release without it
						being publicly recorded — forever.</span
					>
					<span data-vp-show="mobile"
						>Every release signed in a public append-only Rekor log. Backdoors are
						permanently visible.</span
					>
				</div>
				<div class="trust-snippet">
					<span class="key">rekor</span> entry
					<span class="key">{rekorPrefix}</span>…<span class="key">{rekorSuffix}</span><br
					/>
					signed by <span class="key">github-actions OIDC</span><br />
					<span class="ok">✓ keyless · Sigstore Fulcio + Rekor</span>
				</div>
			</div>
			<div class="trust-card">
				<div class="trust-card-num">METHOD 03</div>
				<div class="trust-card-title">
					Self-host the entire stack
					<span class="tier-tag">Tier 2 spec</span>
				</div>
				<div class="trust-card-body">
					<span data-vp-show="desktop"
						>The sync server is the SvelteKit Worker + D1 + R2 you already see in
						this repo. Tier 1 deploys it as a single Cloudflare project. Bring-
						your-own-bucket is on the Tier 2 roadmap — until then, the Worker
						code is reproducible and signed end-to-end.</span
					>
					<span data-vp-show="mobile"
						>Worker + D1 + R2. BYO bucket on the Tier 2 roadmap; reproducible
						today.</span
					>
				</div>
				<div class="trust-snippet">
					<span class="key">$</span> wrangler pages deploy<br />
					<span class="ok">✓</span> sigstore + rekor on every release<br />
					<span class="ok">✓</span> reproducible from
					<span class="key">git checkout v{PUBLIC_VAULT_VERSION}</span><br />
					<span class="key">bundle:</span>
					<span class="ok">{BUNDLE_HASH_SHORT}</span>
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
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
	}
	.trust-card-title :global(.tier-tag) {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
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

	@media (max-width: 45em) {
		.trust-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 30em) {
		.trust-card {
			padding: 18px 16px;
			gap: 10px;
		}
		.trust-card-title {
			font-size: 16px;
		}
		.trust-card-body {
			font-size: 12px;
		}
		.trust-snippet {
			font-size: 10px;
			padding: 10px 12px;
		}
	}
</style>
