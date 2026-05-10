<script lang="ts">
	import { STACK_STEPS_USER, STACK_LAYERS_TECH } from '$lib/data/landing';
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow">
			<span class="dot"></span>
			<span data-show="user">How VuVault works</span>
			<span data-show="tech">The cryptographic stack</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>Four steps. <span class="italic-serif">Nothing else needed.</span></span
			>
			<span data-show="tech"
				>Ten layers. <span class="italic-serif">Each defensible.</span></span
			>
		</h2>

		<!-- USER MODE: 4-step flow -->
		<div class="stack-user" data-show="user">
			{#each STACK_STEPS_USER as step (step.num)}
				<div class="stack-step">
					<div class="stack-step-num">{step.num}</div>
					<div class="stack-step-icon">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M12 11h.01M7 13c0 1 1 4 5 4s5-3 5-4M9 9c0-1 0-2 3-2s3 1 3 2"
							/><path d="M3 12a9 9 0 0118 0v0a9 9 0 01-18 0z" /></svg
						>
					</div>
					<div class="stack-step-title">{step.title}</div>
					<div class="stack-step-body">{step.body}</div>
				</div>
			{/each}
		</div>

		<!-- TECH MODE: 10-layer stack -->
		<div class="stack-tech" data-show="tech">
			{#each STACK_LAYERS_TECH as layer (layer.num)}
				<div class="layer">
					<div class="layer-num">{layer.num.replace('L', '')}</div>
					<div class="layer-name">
						{layer.name}<small>{layer.role}</small>
					</div>
					<div class="layer-prim">{layer.prim}</div>
					<div class="layer-tag {layer.tag}">{layer.tagText}</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.stack-user {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
		margin-top: 24px;
		position: relative;
	}
	.stack-user::before {
		content: '';
		position: absolute;
		top: 36px;
		left: 12.5%;
		right: 12.5%;
		height: 1px;
		background: repeating-linear-gradient(
			90deg,
			var(--border-mid) 0,
			var(--border-mid) 4px,
			transparent 4px,
			transparent 8px
		);
		z-index: 0;
	}
	.stack-step {
		position: relative;
		z-index: 1;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		backdrop-filter: blur(12px);
	}
	.stack-step-num {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		background: var(--bg);
		border: 1px solid var(--border-strong);
		border-radius: 50%;
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 700;
		color: var(--accent);
	}
	.stack-step-icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: var(--accent-dim);
		border-radius: var(--radius);
		color: var(--accent);
	}
	.stack-step-title {
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
	}
	.stack-step-body {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}

	.stack-tech {
		margin-top: 16px;
		display: grid;
		grid-template-columns: 1fr;
		gap: 4px;
		max-height: 60dvh;
		overflow-y: auto;
		padding-right: 8px;
		scrollbar-width: thin;
		scrollbar-color: var(--border-mid) transparent;
	}
	.stack-tech::-webkit-scrollbar {
		width: 6px;
	}
	.stack-tech::-webkit-scrollbar-thumb {
		background: var(--border-mid);
		border-radius: 3px;
	}
	.layer {
		display: grid;
		grid-template-columns: 64px 1fr 1.4fr auto;
		gap: 20px;
		align-items: center;
		padding: 14px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	.layer:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
		transform: translateX(2px);
	}
	.layer-num {
		font-family: var(--font-mono);
		font-size: 22px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: -0.02em;
	}
	.layer-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.005em;
	}
	.layer-name small {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-3);
		margin-top: 2px;
		letter-spacing: 0;
	}
	.layer-prim {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-2);
		letter-spacing: 0;
	}
	.layer-tag {
		font-size: 10px;
		font-weight: 600;
		padding: 4px 8px;
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		white-space: nowrap;
		font-family: var(--font-mono);
	}
	.layer-tag.shipped {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}
	.layer-tag.partial {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}
	.layer-tag.alone {
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
	}

	@media (max-width: 45em) {
		.stack-user {
			grid-template-columns: 1fr;
		}
		.stack-user::before {
			display: none;
		}
		.layer {
			grid-template-columns: 48px 1fr;
			gap: 12px;
		}
		.layer-prim,
		.layer-tag {
			display: none;
		}
	}
	@media (max-width: 30em) {
		.stack-step {
			padding: 18px 16px;
			gap: 10px;
		}
		.stack-step-num {
			width: 32px;
			height: 32px;
			font-size: 12px;
		}
		.stack-step-title {
			font-size: 15px;
		}
		.stack-step-body {
			font-size: 12px;
		}
		.stack-tech {
			max-height: none;
			padding-right: 0;
		}
		.layer {
			grid-template-columns: 36px 1fr;
			padding: 10px 12px;
			gap: 10px;
		}
		.layer-num {
			font-size: 16px;
		}
		.layer-name {
			font-size: 13px;
		}
		.layer-name small {
			font-size: 10px;
		}
	}
</style>
