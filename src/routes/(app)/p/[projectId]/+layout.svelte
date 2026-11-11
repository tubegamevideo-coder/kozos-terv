<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { RefreshCw } from '@lucide/svelte';
	import type { LayoutProps } from './$types';
	let { data, children }: LayoutProps = $props();

	let pending = $state(false);
	/** Szerkesztés közben nem frissítünk magunktól, csak jelezzük, hogy van új változás. */
	const editing = () => !!document.querySelector('[data-editing="true"]');

	onMount(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const es = new EventSource(`/p/${data.project.id}/events`);
		es.onmessage = () => {
			if (editing()) {
				pending = true;
				return;
			}
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => invalidateAll(), 300);
		};
		return () => {
			es.close();
			if (timer) clearTimeout(timer);
		};
	});
</script>

{#if pending}
	<div class="live" role="status">
		<span class="dot"></span>
		<span class="grow">Valaki közben módosított a projektben. A frissítés a mentetlen szerkesztést elveti.</span>
		<button class="btn quiet sm" onclick={async () => { pending = false; await invalidateAll(); }}><RefreshCw size={14} /> Frissítés</button>
	</div>
{/if}
{@render children()}

<style>
	.live {
		position: sticky;
		top: 0;
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 24px;
		background: var(--mark-wash);
		color: var(--mark-ink);
		font-size: 13.5px;
		border-bottom: 1px solid color-mix(in srgb, var(--mark) 40%, transparent);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--mark);
	}
</style>
