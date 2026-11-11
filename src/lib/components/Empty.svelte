<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<div class="empty">
	<p class="t">{title}</p>
	{#if children}<div class="d">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		padding: 22px 20px;
		border: 1px dashed var(--rule-strong);
		border-radius: var(--r-md);
		color: var(--graphite);
	}
	.t {
		margin: 0;
		color: var(--ink);
		font-weight: 500;
	}
	.d {
		margin-top: 4px;
		font-size: 13.5px;
	}
	.d :global(p) {
		margin: 4px 0 0;
	}
</style>
