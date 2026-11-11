<script lang="ts">
	import { initials, personHue } from '../ui';
	let { name, size = 24, claude = false }: { name: string; size?: number; claude?: boolean } = $props();
	const hue = $derived(personHue(name));
</script>

<span
	class="av"
	class:claude
	style:--h={hue}
	style:width="{size}px"
	style:height="{size}px"
	style:font-size="{Math.round(size * 0.42)}px"
	title={claude ? `${name} Claude-ja` : name}
	aria-hidden="true"
>
	{initials(name)}
	{#if claude}<span class="spark"></span>{/if}
</span>

<style>
	.av {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		border-radius: 50%;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: light-dark(hsl(var(--h) 45% 28%), hsl(var(--h) 50% 82%));
		background: light-dark(hsl(var(--h) 45% 88%), hsl(var(--h) 30% 26%));
	}
	/* Claude-jelölés: ibolya gyűrű és egy kis csillag a sarokban */
	.av.claude {
		box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--claude);
	}
	.spark {
		position: absolute;
		right: -3px;
		bottom: -3px;
		width: 45%;
		height: 45%;
		min-width: 9px;
		min-height: 9px;
		background: var(--claude);
		clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
	}
</style>
