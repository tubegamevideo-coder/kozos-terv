<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import {
		CircleHelp,
		FileText,
		GitPullRequestArrow,
		LayoutDashboard,
		Lightbulb,
		LogOut,
		Menu,
		Plug,
		Search,
		Settings,
		ShieldCheck
	} from '@lucide/svelte';
	import Avatar from '../../lib/components/Avatar.svelte';
	import CommandPalette from '../../lib/components/CommandPalette.svelte';
	import Toaster from '../../lib/components/Toaster.svelte';
	import ThemeToggle from '../../lib/components/ThemeToggle.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	interface ProjectNav {
		id: string;
		name: string;
		docs: { id: string; title: string; kind: string; isProtected: boolean }[];
		counts: { proposals: number; questions: number; disputed: number };
	}
	const nav = $derived((page.data as { projectNav?: ProjectNav }).projectNav ?? null);
	const path = $derived(page.url.pathname);
	let paletteOpen = $state(false);
	let menuOpen = $state(false);

	afterNavigate(() => (menuOpen = false));

	function onkey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			paletteOpen = !paletteOpen;
		}
	}
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
</script>

<svelte:window onkeydown={onkey} />

<div class="shell" class:menu-open={menuOpen}>
	<aside class="side" aria-label="Navigáció">
		<a class="brand" href="/">
			<span class="mark" aria-hidden="true"><i></i><i></i></span>
			<span>Teréz</span>
		</a>

		<button class="search" onclick={() => (paletteOpen = true)}>
			<Search size={15} /><span class="grow">Keresés</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
		</button>

		{#if nav}
			<div class="group">
				<p class="gh">{nav.name}</p>
				<a class="item" class:on={path === `/p/${nav.id}`} href={`/p/${nav.id}`}><LayoutDashboard size={16} /> Áttekintés</a>
				<a class="item" class:on={path.startsWith(`/p/${nav.id}/proposals`)} href={`/p/${nav.id}/proposals`}>
					<GitPullRequestArrow size={16} /> <span class="grow">Jóváhagyásra vár</span>
					{#if nav.counts.proposals}<span class="count mark">{nav.counts.proposals}</span>{/if}
				</a>
				<a class="item" class:on={path.startsWith(`/p/${nav.id}/questions`)} href={`/p/${nav.id}/questions`}>
					<CircleHelp size={16} /> <span class="grow">Kérdések</span>
					{#if nav.counts.questions}<span class="count" class:mark={nav.counts.disputed > 0}>{nav.counts.questions}</span>{/if}
				</a>
				<a class="item" class:on={path.startsWith(`/p/${nav.id}/ideas`)} href={`/p/${nav.id}/ideas`}><Lightbulb size={16} /> Ötletek</a>
				<a class="item" class:on={path.startsWith(`/p/${nav.id}/settings`)} href={`/p/${nav.id}/settings`}><Settings size={16} /> Beállítások</a>
			</div>
			<div class="group">
				<p class="gh">Dokumentumok</p>
				{#each nav.docs as d (d.id)}
					<a class="item doc" class:on={path.startsWith(`/p/${nav.id}/d/${d.id}`)} href={`/p/${nav.id}/d/${d.id}`} title={d.isProtected ? 'Védett: a Claude ide csak javasolhat' : d.title}>
						{#if d.isProtected}<ShieldCheck size={16} />{:else}<FileText size={16} />{/if}
						<span class="grow ell">{d.title}</span>
					</a>
				{:else}
					<p class="faint tiny pad">Még nincs dokumentum.</p>
				{/each}
			</div>
		{/if}

		<div class="group">
			<p class="gh">Projektek</p>
			{#each data.projects as p (p.id)}
				<a class="item" class:on={nav?.id === p.id && false} href={`/p/${p.id}`}>
					<span class="pdot" class:cur={nav?.id === p.id}></span>
					<span class="grow ell">{p.name}</span>
					{#if p.unseen && nav?.id !== p.id}<span class="count" title="Új változások">{p.unseen}</span>{/if}
				</a>
			{/each}
		</div>

		<div class="foot">
			<a class="item" class:on={path === '/'} href="/#claude"><Plug size={16} /> Claude csatlakoztatása</a>
			<div class="theme"><span class="faint small">Megjelenés</span><ThemeToggle /></div>
			<div class="me">
				<Avatar name={data.user.name} size={26} />
				<span class="grow ell small">{data.user.name}</span>
				<form method="POST" action="/logout">
					<button class="btn ghost icon sm" title="Kilépés" aria-label="Kilépés"><LogOut size={15} /></button>
				</form>
			</div>
		</div>
	</aside>

	<div class="main">
		<header class="topbar">
			<button class="btn ghost icon" onclick={() => (menuOpen = !menuOpen)} aria-label="Menü"><Menu size={18} /></button>
			<span class="ell">{nav?.name ?? 'Teréz'}</span>
			<button class="btn ghost icon" onclick={() => (paletteOpen = true)} aria-label="Keresés"><Search size={18} /></button>
		</header>
		{@render children()}
	</div>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => (menuOpen = false)}></div>
</div>

<CommandPalette bind:open={paletteOpen} projects={data.projects} project={nav ? { id: nav.id, name: nav.name, docs: nav.docs } : null} />
<Toaster />

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar) minmax(0, 1fr);
		min-height: 100vh;
	}
	.side {
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 16px 12px 12px;
		border-right: 1px solid var(--rule);
		background: var(--sunken);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 8px;
		color: var(--ink);
		font-weight: 600;
		font-size: 15px;
		letter-spacing: -0.01em;
	}
	.brand:hover {
		text-decoration: none;
	}
	/* Két egymásba érő kör: ember és Claude ugyanazon a terven */
	.mark {
		position: relative;
		width: 26px;
		height: 18px;
	}
	.mark i {
		position: absolute;
		top: 0;
		width: 18px;
		height: 18px;
		border-radius: 50%;
	}
	.mark i:first-child {
		left: 0;
		background: var(--teal);
	}
	.mark i:last-child {
		left: 8px;
		background: var(--claude);
		opacity: 0.85;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 10px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--graphite);
		cursor: pointer;
		text-align: left;
	}
	.search:hover {
		border-color: var(--faint);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.gh {
		margin: 0 0 4px;
		padding: 0 8px;
		font-size: 12px;
		font-weight: 600;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 32px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		color: var(--graphite);
		font-weight: 500;
	}
	.item:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		color: var(--ink);
		text-decoration: none;
	}
	.item.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 0 0 1px var(--rule);
	}
	.item :global(svg) {
		flex: none;
		color: var(--faint);
	}
	.item.on :global(svg) {
		color: var(--teal);
	}
	.item.doc {
		font-weight: 400;
	}
	.ell {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pad {
		padding: 0 8px;
		margin: 0;
	}
	.count {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		font-size: 11.5px;
		font-weight: 600;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--graphite);
	}
	.count.mark {
		background: var(--mark);
		color: #3d2a00;
	}
	.pdot {
		width: 8px;
		height: 8px;
		margin: 0 4px;
		border-radius: 2px;
		background: var(--rule-strong);
		flex: none;
	}
	.pdot.cur {
		background: var(--teal);
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 12px;
		border-top: 1px solid var(--rule);
	}
	.theme {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 4px 2px 8px;
	}
	.me {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 4px 0 8px;
	}
	.main {
		min-width: 0;
	}
	.topbar,
	.scrim {
		display: none;
	}

	@media (max-width: 900px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.side {
			position: fixed;
			z-index: 40;
			left: 0;
			width: min(300px, 86vw);
			transform: translateX(-100%);
			transition: transform 0.2s ease;
		}
		.menu-open .side {
			transform: none;
			box-shadow: var(--shadow-pop);
		}
		.menu-open .scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 30;
			background: rgb(18 22 29 / 0.3);
		}
		.topbar {
			position: sticky;
			top: 0;
			z-index: 20;
			display: flex;
			align-items: center;
			gap: 8px;
			height: 52px;
			padding: 0 8px;
			background: var(--paper);
			border-bottom: 1px solid var(--rule);
			font-weight: 600;
		}
		.topbar .ell {
			flex: 1;
		}
	}
</style>
