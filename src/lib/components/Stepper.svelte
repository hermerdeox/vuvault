<script lang="ts">
	type Step = { id: string; name: string };
	type Props = {
		steps: Step[];
		current: string;
	};

	let { steps, current }: Props = $props();

	const currentIndex = $derived(steps.findIndex((s) => s.id === current));
	const currentStep = $derived(steps[currentIndex]);
</script>

<nav class="stepper" aria-label="Progress">
	<!-- xs viewport: 7 numbered circles + dividers eat ≈280px of header
	     width, which collides with the BrandMark + Exit button on a
	     360px phone. Show a compact "N of 7 · Name" pill instead. -->
	<div class="stepper-compact" aria-hidden="true">
		<span class="stepper-compact-count"
			>{currentIndex + 1}<span class="muted">/{steps.length}</span></span
		>
		{#if currentStep}
			<span class="stepper-compact-name">{currentStep.name}</span>
		{/if}
	</div>
	<div class="stepper-full" aria-hidden="true">
		{#each steps as step, i (step.id)}
			<div
				class="step"
				class:done={i < currentIndex}
				class:active={i === currentIndex}
				data-step={step.id}
			>
				<span class="num">{i + 1}</span>
				<span class="name">{step.name}</span>
			</div>
			{#if i < steps.length - 1}
				<span class="divider"></span>
			{/if}
		{/each}
	</div>
</nav>

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.stepper-full {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.stepper-compact {
		display: none;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-radius: 999px;
		background: var(--accent-dim);
		color: var(--accent);
		font-size: 12px;
		font-weight: 600;
	}
	.stepper-compact-count {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
	}
	.stepper-compact-count .muted {
		color: var(--text-3);
	}
	.stepper-compact-name {
		color: var(--text);
		font-weight: 600;
		font-size: 12px;
		letter-spacing: -0.005em;
	}
	@media (max-width: 30em) {
		.stepper-full {
			display: none;
		}
		.stepper-compact {
			display: inline-flex;
		}
	}
	.step {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
		transition: var(--transition);
		white-space: nowrap;
	}
	.num {
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 1px solid var(--border-mid);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
	}
	.name {
		display: none;
	}
	@media (min-width: 64em) {
		.name {
			display: block;
		}
	}

	.step.done {
		color: var(--text-2);
	}
	.step.done .num {
		background: var(--success);
		border-color: var(--success);
		color: var(--bg);
	}
	.step.active {
		background: var(--accent-dim);
		color: var(--accent);
	}
	.step.active .num {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
	}

	.divider {
		width: 16px;
		height: 1px;
		background: var(--border);
	}
	@media (max-width: 45em) {
		.divider {
			width: 8px;
		}
	}
</style>
