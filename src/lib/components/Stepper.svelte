<script lang="ts">
	type Step = { id: string; name: string };
	type Props = {
		steps: Step[];
		current: string;
	};

	let { steps, current }: Props = $props();

	const currentIndex = $derived(steps.findIndex((s) => s.id === current));
</script>

<nav class="stepper" aria-label="Progress">
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
			<span class="divider" aria-hidden="true"></span>
		{/if}
	{/each}
</nav>

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
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
	@media (min-width: 1100px) {
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
	@media (max-width: 720px) {
		.divider {
			width: 8px;
		}
	}
</style>
