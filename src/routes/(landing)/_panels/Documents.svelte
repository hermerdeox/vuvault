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
						>Tier 2 design: your property deed, car title, contracts, medical
						records — the documents you actually can't afford to lose
						<span class="italic-serif">or have leaked.</span> All sealed under the
						same ML-KEM-1024 envelope as your passwords. Today the vault holds
						document <em>metadata</em>; cross-origin storage and signing arrive
						with the Tier 2 sync server.</span
					>
					<span data-show="user" data-vp-show="mobile"
						>Tier 2: deeds, titles, contracts, records — sealed under the same
						envelope as your passwords. Today metadata-only.</span
					>
					<span data-show="tech" data-vp-show="desktop"
						>Tier 2 design: documents chunked, padded to a fixed-bucket spectrum,
						and encrypted under per-item hybrid X25519 + ML-KEM-1024 envelopes.
						Server holds opaque ciphertext blobs only — it cannot tell a 2-page
						lease from a 200-page contract. Padding lives in the Tier 2 spec, not
						yet in <code>vault-codec.ts</code>.</span
					>
					<span data-show="tech" data-vp-show="mobile"
						>Chunked · padded · per-item hybrid envelope. Server holds opaque
						blobs only.</span
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
									>Tier 2 design: cloud storage providers promise they won't look
									at your files. We will ship something stronger — a system where
									we mathematically cannot. Today the vault is local-only and the
									cross-origin server is an HTTP 501 stub on purpose.</span
								>
								<span data-show="tech"
									>Tier 2 design: documents encrypted client-side before upload;
									server holds opaque blobs; subpoenaing the future server yields
									ciphertext nobody can decrypt — including us. The
									<code>functions/api/[[catchall]].ts</code> stub returns 501 today
									and refuses to read its own request body.</span
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
						<svg viewBox="0 0 1024 768" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
							<rect width="1024" height="768" fill="#000"/>
							<text x="40" y="22" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="700" fill="#fff">9:41 AM · Wed Mar 15</text>
							<g transform="translate(900, 12)">
								<rect x="0" y="2" width="3" height="8" rx="0.5" fill="#fff"/>
								<rect x="5" y="0" width="3" height="10" rx="0.5" fill="#fff"/>
								<rect x="10" y="-2" width="3" height="12" rx="0.5" fill="#fff"/>
								<text x="22" y="11" font-family="Instrument Sans, sans-serif" font-size="11" fill="#fff">5G</text>
								<rect x="50" y="0" width="22" height="10" rx="2" fill="none" stroke="#fff" stroke-width="1"/>
								<rect x="52" y="2" width="16" height="6" rx="0.5" fill="#22c55e"/>
								<rect x="72" y="3" width="2" height="4" rx="0.5" fill="#fff"/>
								<text x="80" y="11" font-family="Instrument Sans, sans-serif" font-size="11" fill="#fff">87%</text>
							</g>
							<rect x="0" y="32" width="1024" height="52" fill="#0a0a0a"/>
							<line x1="0" y1="84" x2="1024" y2="84" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<rect x="24" y="46" width="26" height="26" rx="6" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)"/>
							<text x="37" y="64" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="14" font-weight="800" fill="#f5f5f0">V</text>
							<text x="60" y="63" font-family="Instrument Sans, sans-serif" font-size="14" font-weight="700" fill="#fff">VuVault</text>
							<text x="138" y="63" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">/ Documents</text>
							<rect x="280" y="44" width="380" height="28" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
							<circle cx="294" cy="58" r="5" fill="none" stroke="#666" stroke-width="1.4"/>
							<line x1="298" y1="62" x2="302" y2="66" stroke="#666" stroke-width="1.4"/>
							<text x="308" y="62" font-family="Instrument Sans, sans-serif" font-size="11" fill="#666">Search 47 documents</text>
							<rect x="844" y="44" width="84" height="28" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
							<text x="886" y="62" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="600" fill="#b8b8b8">+ Upload</text>
							<rect x="938" y="44" width="64" height="28" rx="14" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.3)"/>
							<circle cx="952" cy="58" r="3" fill="#22c55e"/>
							<text x="960" y="62" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="700" fill="#22c55e">SEALED</text>
							<rect x="0" y="84" width="200" height="684" fill="#080808"/>
							<line x1="200" y1="84" x2="200" y2="768" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<text x="20" y="116" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#666" letter-spacing="1.5">CATEGORIES</text>
							<g font-family="Instrument Sans, sans-serif" font-size="13">
								<rect x="22" y="129" width="14" height="14" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
								<circle cx="29" cy="136" r="2" fill="#888"/>
								<text x="46" y="141" fill="#b8b8b8">Logins</text>
								<text x="178" y="141" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">14</text>
								<rect x="22" y="161" width="16" height="11" rx="1.5" fill="none" stroke="#888" stroke-width="1.4"/>
								<line x1="22" y1="165" x2="38" y2="165" stroke="#888" stroke-width="1.4"/>
								<text x="46" y="171" fill="#b8b8b8">Cards</text>
								<text x="178" y="171" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">2</text>
								<rect x="22" y="191" width="14" height="11" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
								<circle cx="29" cy="197" r="2" fill="#888"/>
								<text x="46" y="201" fill="#b8b8b8">IDs &amp; Passports</text>
								<text x="178" y="201" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">4</text>
								<rect x="12" y="217" width="176" height="32" rx="6" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.25)"/>
								<rect x="22" y="227" width="14" height="14" rx="1.5" fill="none" stroke="#00d4ff" stroke-width="1.4"/>
								<line x1="25" y1="231" x2="33" y2="231" stroke="#00d4ff" stroke-width="1.4"/>
								<line x1="25" y1="234" x2="33" y2="234" stroke="#00d4ff" stroke-width="1.4"/>
								<line x1="25" y1="237" x2="30" y2="237" stroke="#00d4ff" stroke-width="1.4"/>
								<text x="46" y="237" font-weight="600" fill="#fff">Documents</text>
								<text x="178" y="237" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#00d4ff">47</text>
								<rect x="22" y="261" width="14" height="14" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
								<line x1="26" y1="265" x2="34" y2="265" stroke="#888" stroke-width="1.4"/>
								<line x1="26" y1="269" x2="34" y2="269" stroke="#888" stroke-width="1.4"/>
								<text x="46" y="271" fill="#b8b8b8">Secure notes</text>
								<text x="178" y="271" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">8</text>
								<path d="M22 295 L29 290 L36 295 L36 302 L29 307 L22 302 Z" fill="none" stroke="#888" stroke-width="1.4"/>
								<text x="46" y="301" fill="#b8b8b8">Crypto seeds</text>
								<text x="178" y="301" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">3</text>
							</g>
							<line x1="0" y1="708" x2="200" y2="708" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<circle cx="22" cy="730" r="3" fill="#22c55e"/>
							<text x="34" y="734" font-family="Instrument Sans, sans-serif" font-size="10" fill="#b8b8b8">Local · sync Tier 2</text>
							<text x="22" y="752" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">2.4 MB · ML-KEM-1024</text>
							<rect x="200" y="84" width="240" height="684" fill="#0a0a0a"/>
							<line x1="440" y1="84" x2="440" y2="768" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<text x="220" y="116" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#666" letter-spacing="1.5">47 DOCUMENTS · ALL</text>
							<rect x="212" y="130" width="216" height="64" rx="8" fill="rgba(0,212,255,0.06)" stroke="rgba(0,212,255,0.25)"/>
							<rect x="224" y="144" width="32" height="40" rx="4" fill="#172a5e" stroke="rgba(0,212,255,0.3)"/>
							<text x="240" y="170" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#00d4ff">PDF</text>
							<text x="266" y="152" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#fff">Warranty Deed</text>
							<text x="266" y="168" font-family="Instrument Sans, sans-serif" font-size="10" fill="#888">128 Catawba Pl · Greenville</text>
							<text x="266" y="184" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">2.1 MB · signed · sealed</text>
							<rect x="212" y="206" width="216" height="60" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)"/>
							<rect x="224" y="220" width="32" height="36" rx="4" fill="#1a1a1a" stroke="rgba(255,255,255,0.1)"/>
							<text x="240" y="242" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#888">PDF</text>
							<text x="266" y="228" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#e8e8e8">Vehicle Title</text>
							<text x="266" y="244" font-family="Instrument Sans, sans-serif" font-size="10" fill="#888">2024 Tesla Model 3</text>
							<text x="266" y="258" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">1.4 MB · 09 / 04 / 2024</text>
							<rect x="212" y="278" width="216" height="60" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)"/>
							<rect x="224" y="292" width="32" height="36" rx="4" fill="#1a1a1a" stroke="rgba(255,255,255,0.1)"/>
							<text x="240" y="314" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#888">PDF</text>
							<text x="266" y="300" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#e8e8e8">Office Lease 2025</text>
							<text x="266" y="316" font-family="Instrument Sans, sans-serif" font-size="10" fill="#888">Suite 412 · 24 months</text>
							<text x="266" y="330" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">3.8 MB · 14 pages</text>
							<rect x="212" y="350" width="216" height="60" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)"/>
							<rect x="224" y="364" width="32" height="36" rx="4" fill="#1a1a1a" stroke="rgba(255,255,255,0.1)"/>
							<text x="240" y="386" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#888">PDF</text>
							<text x="266" y="372" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#e8e8e8">1040 — Tax Return</text>
							<text x="266" y="388" font-family="Instrument Sans, sans-serif" font-size="10" fill="#888">Tax year 2024</text>
							<text x="266" y="402" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">1.1 MB · April 2025</text>
							<rect x="212" y="422" width="216" height="60" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)"/>
							<rect x="224" y="436" width="32" height="36" rx="4" fill="#0a3a1a" stroke="rgba(34,197,94,0.3)"/>
							<text x="240" y="458" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#22c55e">JPG</text>
							<text x="266" y="444" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#e8e8e8">Passport Scan</text>
							<text x="266" y="460" font-family="Instrument Sans, sans-serif" font-size="10" fill="#888">Expires Aug 2031</text>
							<text x="266" y="474" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">880 KB · biometric pg</text>
							<rect x="212" y="494" width="216" height="60" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,165,0,0.2)"/>
							<rect x="224" y="508" width="32" height="36" rx="4" fill="#3a2810" stroke="rgba(255,165,0,0.3)"/>
							<text x="240" y="530" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="8" font-weight="700" fill="#ffa500">LOCK</text>
							<text x="266" y="516" font-family="Instrument Sans, sans-serif" font-size="12" font-weight="600" fill="#e8e8e8">Last Will</text>
							<text x="266" y="532" font-family="Instrument Sans, sans-serif" font-size="10" fill="#ffa500">Time-locked · 2055-01-01</text>
							<text x="266" y="546" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">tlock + drand</text>
							<rect x="440" y="84" width="584" height="684" fill="#0a0a0a"/>
							<rect x="440" y="84" width="584" height="40" fill="#080808"/>
							<line x1="440" y1="124" x2="1024" y2="124" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<text x="460" y="108" font-family="Instrument Sans, sans-serif" font-size="13" font-weight="600" fill="#fff">Warranty Deed.pdf</text>
							<text x="588" y="108" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">2.1 MB · 4 pages · signed</text>
							<g transform="translate(750, 92)">
								<rect x="0" y="0" width="56" height="22" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
								<text x="28" y="15" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="#b8b8b8">1 / 4</text>
								<rect x="64" y="0" width="50" height="22" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
								<text x="89" y="15" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="600" fill="#b8b8b8">100%</text>
								<rect x="124" y="0" width="50" height="22" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
								<text x="149" y="15" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="600" fill="#b8b8b8">⤓ Save</text>
								<rect x="184" y="0" width="84" height="22" rx="4" fill="rgba(0,212,255,0.1)" stroke="rgba(0,212,255,0.3)"/>
								<text x="226" y="15" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="700" fill="#00d4ff">↗ Sign / Verify</text>
							</g>
							<rect x="498" y="148" width="468" height="572" rx="3" fill="#ffffff"/>
							<g transform="translate(732, 434) rotate(-30)" opacity="0.06">
								<text x="0" y="0" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="34" font-weight="800" fill="#172a5e" letter-spacing="6">VUVAULT</text>
								<text x="0" y="38" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="14" font-weight="700" fill="#172a5e" letter-spacing="4">SEALED · ENCRYPTED</text>
							</g>
							<text x="732" y="186" text-anchor="middle" font-family="Instrument Serif, serif" font-size="22" font-weight="700" fill="#0a0a0a" letter-spacing="1">WARRANTY DEED</text>
							<line x1="540" y1="200" x2="924" y2="200" stroke="#0a0a0a" stroke-width="0.6"/>
							<text x="732" y="218" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" fill="#444" letter-spacing="2">STATE OF SOUTH CAROLINA · COUNTY OF GREENVILLE</text>
							<text x="528" y="248" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">KNOW ALL MEN BY THESE PRESENTS, that the Grantor</text>
							<text x="528" y="262" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">named below, in consideration of the sum of Three Hundred</text>
							<text x="528" y="276" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="700" fill="#1a1a1a">Forty-Eight Thousand and 00/100 Dollars ($348,000.00),</text>
							<text x="528" y="290" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">paid by the Grantee, has granted, bargained, sold, and</text>
							<text x="528" y="304" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">released unto the Grantee, and Grantee's heirs and assigns,</text>
							<text x="528" y="318" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">the following described real property:</text>
							<rect x="528" y="334" width="408" height="76" fill="#f7f7f3" stroke="#cccccc" stroke-width="0.5"/>
							<text x="540" y="352" font-family="JetBrains Mono, monospace" font-size="8" fill="#1a1a1a">Lot 14, Block C, Catawba Place Subdivision,</text>
							<text x="540" y="366" font-family="JetBrains Mono, monospace" font-size="8" fill="#1a1a1a">according to plat recorded in Plat Book 47,</text>
							<text x="540" y="380" font-family="JetBrains Mono, monospace" font-size="8" fill="#1a1a1a">Page 128, of the public records of Greenville</text>
							<text x="540" y="394" font-family="JetBrains Mono, monospace" font-size="8" fill="#1a1a1a">County, South Carolina. Property address:</text>
							<text x="540" y="408" font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" fill="#1a1a1a">128 Catawba Place, Greenville, SC 29609</text>
							<text x="528" y="436" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">TO HAVE AND TO HOLD all and singular the Premises before</text>
							<text x="528" y="450" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">mentioned unto the Grantee and Grantee's heirs and assigns</text>
							<text x="528" y="464" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">forever. AND the Grantor doth hereby bind themselves and</text>
							<text x="528" y="478" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">their heirs to warrant and forever defend all and singular</text>
							<text x="528" y="492" font-family="Instrument Sans, sans-serif" font-size="9" fill="#1a1a1a">the said Premises unto the Grantee.</text>
							<line x1="528" y1="528" x2="700" y2="528" stroke="#0a0a0a" stroke-width="0.6"/>
							<text x="528" y="542" font-family="JetBrains Mono, monospace" font-size="8" fill="#444">GRANTOR · R LOPEZ</text>
							<path d="M 540 522 Q 552 510, 568 520 Q 580 528, 600 518 Q 620 510, 640 522 Q 658 530, 680 518" fill="none" stroke="#172a5e" stroke-width="1.4" stroke-linecap="round"/>
							<text x="528" y="558" font-family="JetBrains Mono, monospace" font-size="7" fill="#666">Signed in vault · 2024-09-12</text>
							<line x1="752" y1="528" x2="924" y2="528" stroke="#0a0a0a" stroke-width="0.6"/>
							<text x="752" y="542" font-family="JetBrains Mono, monospace" font-size="8" fill="#444">NOTARY · M. WHEELER</text>
							<path d="M 760 522 Q 776 514, 790 520 Q 808 528, 824 520 Q 842 512, 860 522 Q 880 530, 900 522" fill="none" stroke="#172a5e" stroke-width="1.4" stroke-linecap="round"/>
							<text x="752" y="558" font-family="JetBrains Mono, monospace" font-size="7" fill="#666">Notarized · 2024-09-12</text>
							<g transform="translate(870, 618)">
								<circle cx="0" cy="0" r="34" fill="none" stroke="#a0202a" stroke-width="1.4"/>
								<circle cx="0" cy="0" r="28" fill="none" stroke="#a0202a" stroke-width="0.6"/>
								<text x="0" y="-12" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="6" font-weight="700" fill="#a0202a" letter-spacing="0.5">NOTARY PUBLIC</text>
								<text x="0" y="2" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="5" font-weight="700" fill="#a0202a">SOUTH</text>
								<text x="0" y="9" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="5" font-weight="700" fill="#a0202a">CAROLINA</text>
								<text x="0" y="20" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="5" fill="#a0202a">M. WHEELER</text>
							</g>
							<text x="732" y="700" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#888">Page 1 of 4</text>
							<rect x="498" y="724" width="468" height="32" rx="3" fill="#0f1f0f" stroke="rgba(34,197,94,0.4)"/>
							<circle cx="516" cy="740" r="5" fill="#22c55e"/>
							<path d="M 513 740 L 516 743 L 520 738" stroke="#0a0a0a" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
							<text x="528" y="738" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="700" fill="#22c55e">DOCUMENT VERIFIED</text>
							<text x="528" y="750" font-family="JetBrains Mono, monospace" font-size="8" fill="#888">Ed25519 sig · sha384:a4f1c7e2 · transparency log entry #41827</text>
							<rect x="200" y="744" width="824" height="24" fill="#080808"/>
							<line x1="200" y1="744" x2="1024" y2="744" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
							<circle cx="220" cy="757" r="3" fill="#22c55e"/>
							<text x="232" y="761" font-family="Instrument Sans, sans-serif" font-size="10" fill="#b8b8b8">Document opened · local-only · all decryption in-browser</text>
							<text x="980" y="761" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">vault.vu · 47 docs · ML-KEM-1024 active · Tier 2 preview</text>
						</svg>
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
	.docs-intro em {
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
	.ipad-screen svg {
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
