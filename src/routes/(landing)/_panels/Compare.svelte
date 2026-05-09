<script lang="ts">
	import { COMPARE_HEADERS, COMPARE_ROWS, type CompareCell } from '$lib/data/landing';

	function isText(c: CompareCell): c is { text: string } {
		return typeof c === 'object' && 'text' in c;
	}
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow"><span class="dot"></span>vs. the incumbents</div>
		<h2 class="section-title">
			We did the homework.<br />
			<span class="muted">Here's the receipt.</span>
		</h2>

		<div class="compare-wrap">
			<table class="compare-table">
				<thead>
					<tr>
						<th></th>
						{#each COMPARE_HEADERS as header, i (header)}
							<th class:us={i === 0}>{header}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each COMPARE_ROWS as row (row.label)}
						<tr>
							<th>{row.label}<small>{row.sub}</small></th>
							{#each row.cells as cell, i (i)}
								<td class:us={i === 0} class={!isText(cell) ? `cell-${cell}` : ''}>
									{#if cell === 'yes'}
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											><polyline points="20 6 9 17 4 12" /></svg
										>
									{:else if cell === 'no'}
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											><line x1="18" y1="6" x2="6" y2="18" /><line
												x1="6"
												y1="6"
												x2="18"
												y2="18"
											/></svg
										>
									{:else if cell === 'partial'}
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											><line x1="5" y1="12" x2="19" y2="12" /></svg
										>
									{:else if cell === 'tier-2'}
										<span class="tier-pill" title="Architectural design today, ships in Tier 2 (M3 sync server, target 2027)">
											Tier&nbsp;2
										</span>
									{:else if cell === 'tier-3'}
										<span class="tier-pill tier-pill-3" title="Architectural design today, ships in Tier 3 (transparency log + PIR, target 2028)">
											Tier&nbsp;3
										</span>
									{:else if isText(cell)}
										{#if i === 0}
											<strong class="us-price">{cell.text}</strong>
										{:else}
											{cell.text}
										{/if}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="compare-note">
			prices verified May 2026 · sources: vendor pricing pages
		</div>
		<div class="tier-footnote">
			<strong>Tier 2</strong> capabilities are designed and exercised by mock
			fixtures today; the cross-origin component ships with the M3 sync server
			(target 2027). <strong>Tier 3</strong> capabilities (transparency log,
			PIR breach check) target 2028. Today the vault is local-only on every
			cell marked tier-2/tier-3.
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.muted {
		color: var(--text-3);
	}

	.compare-wrap {
		margin-top: 24px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		backdrop-filter: blur(12px);
	}
	.compare-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.compare-table th,
	.compare-table td {
		padding: 12px 16px;
		text-align: left;
		border-bottom: 1px solid var(--border);
	}
	.compare-table thead th {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: var(--surface);
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.compare-table thead th.us {
		color: var(--accent);
		background: var(--accent-dim);
	}
	.compare-table tbody tr:hover {
		background: var(--surface-hover);
	}
	.compare-table tbody tr:last-child th,
	.compare-table tbody tr:last-child td {
		border-bottom: none;
	}
	.compare-table tbody th {
		font-weight: 500;
		color: var(--text);
		font-size: 13px;
		letter-spacing: -0.005em;
	}
	.compare-table tbody th small {
		display: block;
		font-size: 11px;
		color: var(--text-3);
		font-weight: 400;
		margin-top: 2px;
		font-family: var(--font-mono);
		letter-spacing: 0;
	}
	.compare-table td {
		text-align: center;
		font-size: 13px;
		color: var(--text-2);
	}
	.compare-table td.us {
		background: color-mix(in srgb, var(--accent) 6%, transparent);
	}
	.us-price {
		color: var(--text);
	}
	.cell-yes :global(svg) {
		color: var(--success);
	}
	.cell-no :global(svg) {
		color: var(--text-4);
	}
	.cell-partial :global(svg) {
		color: var(--warn);
	}
	.tier-pill {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
		white-space: nowrap;
	}
	.tier-pill-3 {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
	}
	.compare-note {
		margin-top: 14px;
		font-size: 11px;
		color: var(--text-3);
		font-family: var(--font-mono);
		letter-spacing: 0;
	}
	.tier-footnote {
		margin-top: 8px;
		font-size: 11px;
		color: var(--text-3);
		line-height: 1.5;
		max-width: 720px;
	}
	.tier-footnote strong {
		color: var(--text-2);
		font-weight: 600;
	}

	@media (max-width: 880px) {
		.compare-table {
			font-size: 11px;
		}
		.compare-table th,
		.compare-table td {
			padding: 8px 10px;
		}
	}
</style>
