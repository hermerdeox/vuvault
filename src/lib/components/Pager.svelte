<script lang="ts">
	type Panel = { id: string; label: string };
	type Props = {
		panels: Panel[];
		activeId: string;
		onSelect?: (id: string) => void;
	};

	let { panels, activeId, onSelect }: Props = $props();

	function select(id: string) {
		if (onSelect) onSelect(id);
		const el = document.getElementById(id);
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<nav class="pager" aria-label="Page sections">
	{#each panels as p (p.id)}
		<button
			class="dot"
			class:active={p.id === activeId}
			data-label={p.label}
			aria-label={p.label}
			aria-current={p.id === activeId ? 'true' : 'false'}
			onclick={() => select(p.id)}
		></button>
	{/each}
</nav>

<style>
	.pager {
		position: fixed;
		right: 24px;
		top: 50%;
		transform: translateY(-50%);
		z-index: 25;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	@media (max-width: 720px) {
		.pager {
			right: 12px;
			gap: 8px;
		}
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-4);
		border: none;
		padding: 0;
		cursor: pointer;
		transition: var(--transition);
		position: relative;
	}
	.dot:hover {
		background: var(--text-3);
		transform: scale(1.3);
	}
	.dot.active {
		background: var(--accent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
		transform: scale(1.4);
	}
	.dot::before {
		content: attr(data-label);
		position: absolute;
		right: 18px;
		top: 50%;
		transform: translateY(-50%);
		padding: 4px 8px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--text-2);
		white-space: nowrap;
		letter-spacing: 0.04em;
		pointer-events: none;
		opacity: 0;
		transition: var(--transition);
	}
	.dot:hover::before {
		opacity: 1;
	}
</style>
