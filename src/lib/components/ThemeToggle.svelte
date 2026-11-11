<script lang="ts">
	import { Monitor, Moon, Sun } from '@lucide/svelte';
	import { onMount } from 'svelte';

	type Theme = 'system' | 'light' | 'dark';
	let theme = $state<Theme>('system');

	onMount(() => {
		const t = document.documentElement.dataset.theme;
		theme = t === 'light' || t === 'dark' ? t : 'system';
	});

	function set(t: Theme) {
		theme = t;
		const root = document.documentElement;
		if (t === 'system') {
			delete root.dataset.theme;
			document.cookie = 'kt_theme=; path=/; max-age=0; samesite=lax';
		} else {
			root.dataset.theme = t;
			document.cookie = `kt_theme=${t}; path=/; max-age=31536000; samesite=lax`;
		}
		window.dispatchEvent(new Event('kt-theme'));
	}
	const opts: { v: Theme; label: string }[] = [
		{ v: 'system', label: 'A rendszer beállítását követi' },
		{ v: 'light', label: 'Világos' },
		{ v: 'dark', label: 'Sötét' }
	];
</script>

<div class="seg" role="radiogroup" aria-label="Megjelenés">
	{#each opts as o (o.v)}
		<button role="radio" aria-checked={theme === o.v} class:on={theme === o.v} title={o.label} aria-label={o.label} onclick={() => set(o.v)}>
			{#if o.v === 'system'}<Monitor size={14} />{:else if o.v === 'light'}<Sun size={14} />{:else}<Moon size={14} />{/if}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 2px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--ink) 7%, transparent);
	}
	button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 24px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--faint);
		cursor: pointer;
	}
	button:hover {
		color: var(--ink);
	}
	button.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
	}
</style>
