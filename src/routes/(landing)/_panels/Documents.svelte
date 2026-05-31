<!--
  Documents preview panel. The large iPad SVG below is realistic content
  (depicting a PDF viewer with a warranty deed mock), so its hex literals
  are the explicit invariants exception.
-->
<script lang="ts">
	import { viewport } from '$lib/stores/viewport.svelte';
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			<span class="tier-eyebrow-pill">Tier 2 · 2027</span>
			<span data-show="user">Beyond passwords · the ultimate digital vault</span>
			<span data-show="tech">PDF, image, and document storage · same crypto stack</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>Beyond file shares.<br /><span class="italic-serif">Beyond cloud backups.</span></span
			>
			<span data-show="tech"
				>Every byte ciphertext.<br /><span class="italic-serif">No exceptions.</span></span
			>
		</h2>

		<div class="docs-wrap">
			<div>
				<div class="docs-intro">
					<span data-show="user" data-vp-show="desktop"
						>Property deeds, car titles, contracts, medical records — the
						documents you actually can't afford to lose
						<span class="italic-serif">or have leaked.</span> Each file is sealed
						in your browser with the active vault key before it ever touches
						local storage or the sync server. Padding to bucketed sizes lands
						with the Tier 2 CRDT sync server.</span
					>
					<span data-show="user" data-vp-show="mobile"
						>Deeds, titles, contracts, records — sealed in your browser, server
						holds opaque ciphertext only.</span
					>
					<span data-show="tech" data-vp-show="desktop"
						>Per-document AES-256-GCM under the active session AES key with a
						document-scoped AAD (<code>vuvault-doc-aad-v1</code>) bound to the
						document UUID, device salt, and credential id. Encrypted bytes
						persist to a separate Dexie table; sync uploads opaque ciphertext to
						<code>vaults/&lt;accountId&gt;/documents/&lt;blobId&gt;.bin</code> in
						R2. Bucketed padding ships with Tier 2 CRDT sync.</span
					>
					<span data-show="tech" data-vp-show="mobile"
						>Per-doc AES-GCM · document-scoped AAD · opaque ciphertext server-side.</span
					>
				</div>

				<div class="docs-callouts">
					<div class="docs-callout">
						<div class="docs-callout-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
						</div>
						<div>
							<div class="docs-callout-title">
								<span class="tier-tag">Tier 2</span>
								<span data-show="user"
									>Dropbox can read your stuff. <span class="italic-serif">We literally can't.</span></span
								>
								<span data-show="tech">Architectural privacy, not policy privacy</span>
							</div>
							<div class="docs-callout-body">
								<span data-show="user"
									>Cloud storage providers promise they won't look at your files.
									We've shipped something stronger — a system where we
									mathematically cannot. Encrypted document storage is wired
									through the same M3 ciphertext sync path that powers password
									sync.</span
								>
								<span data-show="tech"
									>Documents encrypted client-side before upload; the server
									holds opaque blobs and subpoenaing the M3 sync storage yields
									ciphertext nobody can decrypt — including us. The handler
									lives in <code>src/routes/api/v2/blobs/[uuid]/+server.ts</code>
									and refuses anything but base64-encoded sealed bytes.</span
								>
							</div>
						</div>
					</div>

					<div class="docs-callout docs-callout-extra">
						<div class="docs-callout-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
						</div>
						<div>
							<div class="docs-callout-title">
								<span class="tier-tag tier-tag-3">Tier 3</span>
								<span data-show="user"
									>Sign in place. <span class="italic-serif">Verify forever.</span></span
								>
								<span data-show="tech">In-vault signing · transparency log entry</span>
							</div>
							<div class="docs-callout-body">
								<span data-show="user"
									>Tier 3 design: sign contracts directly inside the vault. Every
									signature timestamped and recorded in the public transparency log
									— without revealing what you signed. Targets 2028 alongside the
									CONIKS-style key directory.</span
								>
								<span data-show="tech"
									>Tier 3 design: Ed25519 signature over document hash, anchored
									in an append-only Merkle log via VRF. Document content stays
									opaque; only existence provable. Lives in the L08 / L11 spec
									(<code>docs/ARCHITECTURE.md</code>).</span
								>
							</div>
						</div>
					</div>

					<div class="docs-callout docs-callout-extra">
						<div class="docs-callout-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
						</div>
						<div>
							<div class="docs-callout-title">
								<span class="tier-tag tier-tag-4">Tier 4</span>
								<span data-show="user">Time-lock for inheritance.</span>
								<span data-show="tech">drand timelock encryption</span>
							</div>
							<div class="docs-callout-body">
								<span data-show="user"
									>Tier 4 design: encrypt your will or instructions to release on
									a future date. Nobody — including you — can decrypt early.
									Beats a notary, a safe deposit box, and a custodian combined.
									Targets 2029+.</span
								>
								<span data-show="tech"
									>Tier 4 design: tlock over BLS12-381 threshold network.
									Encrypts to a future drand round; decryption physically
									impossible until the threshold network publishes that round.
									Not yet in any code path.</span
								>
							</div>
						</div>
					</div>
				</div>

				<div class="docs-types">
					<span class="docs-type">Property deeds</span>
					<span class="docs-type">Vehicle titles</span>
					<span class="docs-type">Contracts</span>
					<span class="docs-type">Medical records</span>
					<span class="docs-type">Tax returns</span>
					<span class="docs-type">Wills</span>
					<span class="docs-type">Passport scans</span>
					<span class="docs-type">SSN / IDs</span>
					<span class="docs-type">Insurance policies</span>
					<span class="docs-type">Crypto seed phrases</span>
				</div>
			</div>

			<div class="ipad-stage">
				{#if !viewport.isMobile}
				<div class="ipad">
					<div class="ipad-camera"></div>
					<div class="ipad-screen">
						<img
							src="/landing/documents-mock.svg"
							alt=""
							loading="lazy"
							decoding="async"
							width="1024"
							height="768"
						/>
					</div>
				</div>
				{:else}
				<!-- Compact mobile substitute for the 1024×768 iPad SVG. -->
				<div class="ipad-mini" role="img" aria-label="Documents preview — 47 sealed">
					<div class="ipad-mini-header">
						<span class="ipad-mini-title">47 documents</span>
						<span class="ipad-mini-pill"><span class="dot"></span>SEALED</span>
					</div>
					<div class="ipad-mini-meta">vault.vu · 2.4 MB · ML-KEM-1024</div>
				</div>
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.docs-wrap {
		margin-top: 24px;
		display: grid;
		grid-template-columns: 1fr 1.6fr;
		gap: 48px;
		align-items: center;
	}
	.docs-intro {
		font-size: 16px;
		line-height: 1.6;
		color: var(--text-2);
		margin-bottom: 22px;
		max-width: 480px;
	}
	.docs-callouts {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.docs-callout {
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 14px;
		align-items: flex-start;
		transition: var(--transition);
	}
	.docs-callout:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
		transform: translateX(2px);
	}
	.docs-callout-icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: var(--accent-dim);
		border-radius: var(--radius-sm);
		color: var(--accent);
		flex-shrink: 0;
	}
	.docs-callout-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 3px;
		letter-spacing: -0.005em;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.docs-callout-body {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.docs-callout-body :global(code) {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text);
	}
	.docs-intro :global(code) {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text);
	}
	.docs-intro :global(em) {
		font-family: var(--font-serif);
		font-style: italic;
	}
	.tier-eyebrow-pill {
		display: inline-flex;
		align-items: center;
		padding: 1px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
		margin-right: 4px;
	}
	.tier-tag {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
	}
	.tier-tag-3 {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
	}
	.tier-tag-4 {
		color: var(--text-3);
		background: var(--surface);
		border-color: var(--border-mid);
	}
	.docs-types {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 18px;
	}
	.docs-type {
		padding: 5px 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-2);
		letter-spacing: 0;
		font-weight: 500;
	}
	.ipad-stage {
		display: flex;
		justify-content: center;
		align-items: center;
		position: relative;
		min-height: 60dvh;
	}
	.ipad-stage::before {
		content: '';
		position: absolute;
		inset: -8%;
		background: radial-gradient(ellipse at center, var(--accent-faint), transparent 60%);
		filter: blur(40px);
		pointer-events: none;
		z-index: 0;
	}
	.ipad {
		position: relative;
		z-index: 1;
		width: 720px;
		max-width: 100%;
		aspect-ratio: 4 / 3;
		background: var(--bg-elev);
		border-radius: 22px;
		padding: 14px;
		box-shadow: var(--shadow-modal);
		transform: perspective(2200px) rotateY(-6deg) rotateX(2deg);
		transition: transform var(--transition-slow);
	}
	.ipad:hover {
		transform: perspective(2200px) rotateY(-3deg) rotateX(1deg);
	}
	.ipad-screen {
		width: 100%;
		height: 100%;
		background: var(--bg);
		border-radius: 12px;
		overflow: hidden;
		position: relative;
	}
	.ipad-screen img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.ipad-camera {
		position: absolute;
		top: 4px;
		left: 50%;
		transform: translateX(-50%);
		width: 6px;
		height: 6px;
		background: var(--surface-strong);
		border-radius: 50%;
		z-index: 5;
	}

	.ipad-mini {
		width: 100%;
		max-width: 340px;
		margin: 4px auto 0;
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ipad-mini-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.ipad-mini-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.005em;
	}
	.ipad-mini-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
		border-radius: 999px;
	}
	.ipad-mini-pill .dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--success);
	}
	.ipad-mini-meta {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
	}

	@media (max-width: 64em) {
		.docs-wrap {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.ipad {
			transform: none;
			width: 100%;
		}
		.ipad-stage {
			min-height: auto;
			padding: 16px 0;
		}
	}
	@media (max-width: 30em) {
		.docs-callout-extra {
			display: none;
		}
		.docs-callout {
			padding: 12px 14px;
		}
		.docs-types {
			gap: 4px;
		}
		.docs-type {
			font-size: 10px;
			padding: 4px 8px;
		}
	}
</style>
