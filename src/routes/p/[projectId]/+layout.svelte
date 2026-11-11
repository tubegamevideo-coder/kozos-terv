<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';
	let { data, children }: LayoutProps = $props();

	const base = $derived(`/p/${data.project.id}`);
	const tabs = $derived([
		{ href: base, label: 'Áttekintés' },
		{ href: `${base}/proposals`, label: `Javaslatok${data.counts.proposals ? ` (${data.counts.proposals})` : ''}` },
		{ href: `${base}/questions`, label: `Kérdések${data.counts.questions ? ` (${data.counts.questions})` : ''}` },
		{ href: `${base}/ideas`, label: 'Ötletek' },
		{ href: `${base}/settings`, label: 'Beállítások' }
	]);

	let pending = $state(false);

	/** Szerkesztés közben nem frissítünk magunktól, csak jelezzük, hogy van új változás. */
	const editing = () => !!document.querySelector('[data-editing="true"]');

	onMount(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const es = new EventSource(`${base}/events`);
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

	const refresh = async () => {
		pending = false;
		await invalidateAll();
	};
</script>

<main class="wide">
	<header>
		<div>
			<a href="/" class="muted">← Projektek</a>
			<h1>{data.project.name}</h1>
			{#if data.project.goal}<p class="muted goal">{data.project.goal}</p>{/if}
		</div>
		<span class="muted">{data.user.name} · {data.role}</span>
	</header>
	<nav class="tabs">
		{#each tabs as t (t.href)}
			<a href={t.href} class:active={page.url.pathname === t.href}>{t.label}</a>
		{/each}
	</nav>
	{#if pending}
		<p class="notice">Valaki közben módosított a projektben. <button class="link" onclick={refresh}>Frissítés</button> (a szerkesztésed elveszhet – előbb mentsd vagy másold ki).</p>
	{/if}
	{@render children()}
</main>

<style>
	.goal { margin: 0; }
	.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 16px 0 20px; flex-wrap: wrap; }
	.tabs a { padding: 8px 12px; text-decoration: none; color: var(--muted); border-bottom: 2px solid transparent; }
	.tabs a.active { color: var(--fg); border-bottom-color: var(--accent); }
	.notice { background: color-mix(in srgb, var(--accent) 12%, transparent); padding: 8px 12px; border-radius: 8px; }
</style>
