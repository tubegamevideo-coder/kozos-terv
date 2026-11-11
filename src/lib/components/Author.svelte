<script lang="ts">
	import Avatar from './Avatar.svelte';
	let { name, via, size = 20, short = false }: { name: string; via: string; size?: number; short?: boolean } = $props();
	const claude = $derived(via === 'claude');
</script>

<span class="author">
	<Avatar {name} {claude} {size} />
	<span class="nm">{name}</span>
	{#if claude}<span class="via">{short ? 'Claude' : 'Claude-ja'}</span>{/if}
</span>

<style>
	.author {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		font-weight: 500;
	}
	.via {
		color: var(--claude);
		font-weight: 500;
	}
</style>
