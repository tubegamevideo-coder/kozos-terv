<script lang="ts">
	import { enhance } from '$app/forms';
	import { Check, TriangleAlert, X } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Diff from '../../../../../lib/Diff.svelte';
	import Author from '../../../../../lib/components/Author.svelte';
	import Empty from '../../../../../lib/components/Empty.svelte';
	import { withToast } from '../../../../../lib/toast.svelte';
	import { ago } from '../../../../../lib/ui';
	let { data }: PageProps = $props();
	const base = $derived(`/p/${data.project.id}`);
	const canDecide = $derived(data.role !== 'viewer');
</script>

<svelte:head><title>Jóváhagyásra vár – {data.project.name}</title></svelte:head>

<div class="page">
	<h1 class="page-title">Jóváhagyásra vár</h1>
	<p class="muted lead">A védett dokumentumokba a Claude-ok nem írhatnak közvetlenül. Amit javasolnak, itt látod: zölddel az új, pirossal a törölt sorok. Elfogadás után a változás a javaslattevő nevén kerül be.</p>

	{#each data.open as p (p.id)}
		<article id={`p-${p.id}`} class="prop panel" class:stale={p.status === 'conflicted' || p.stale}>
			<header class="ph">
				<Author name={p.by} via={p.via} size={24} />
				<span class="muted small">
					{p.newSection ? 'új szakaszt javasol ide:' : 'módosítást javasol:'}
					<a href={`${base}/d/${p.documentId}${p.sectionId ? `#s-${p.sectionId}` : ''}`}>{p.documentTitle}{p.sectionId ? ` › ${p.baseTitle ?? p.title}` : ''}</a>
				</span>
				<span class="faint tiny grow right">{ago(p.createdAt)}</span>
			</header>
			<h2 class="pt">
				{#if p.titleChanged}<span class="old">{p.baseTitle}</span> {p.title}{:else}{p.title}{/if}
			</h2>
			<blockquote class="why">{p.reason}</blockquote>
			{#if p.status === 'conflicted' || p.stale}
				<p class="warn small"><TriangleAlert size={15} /> A szakasz azóta megváltozott ({p.baseRevision}. → {p.currentRevision}. változat), ezért így nem fogadható el. Kérd meg a Claude-ot, hogy építse rá a friss változatra, vagy utasítsd el.</p>
			{/if}
			<Diff lines={p.diff} />
			{#if canDecide}
				<form method="POST" class="decide" use:enhance={withToast()}>
					<input type="hidden" name="proposalId" value={p.id} />
					<input name="note" placeholder="Megjegyzés a döntéshez (nem kötelező)" aria-label="Megjegyzés" />
					<button class="btn quiet" formaction="?/reject"><X size={15} /> Elutasítom</button>
					{#if p.status === 'open' && !p.stale}<button class="btn" formaction="?/accept"><Check size={15} /> Elfogadom</button>{/if}
				</form>
			{/if}
		</article>
	{:else}
		<Empty title="Nincs jóváhagyásra váró javaslat">
			<p>Ha egy Claude a védett fő tervbe szeretne írni, a javaslata itt jelenik meg, és a bal oldali menüben sárga szám jelzi.</p>
		</Empty>
	{/each}

	{#if data.resolved.length}
		<h2 class="section-title done-h">Legutóbb lezárva</h2>
		<div class="panel">
			{#each data.resolved as p (p.id)}
				<div class="done">
					<span class="tag" class:teal={p.status === 'accepted'}>{p.status === 'accepted' ? 'Elfogadva' : 'Elutasítva'}</span>
					<span class="grow">{p.title} <span class="faint small">– {p.by}{p.via === 'claude' ? ' Claude-ja' : ''}</span>{#if p.resolutionNote}<span class="muted small">: {p.resolutionNote}</span>{/if}</span>
					<span class="faint tiny">{ago(p.resolvedAt)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 920px;
		padding: 36px 40px 64px;
	}
	.lead {
		margin: 6px 0 24px;
		max-width: 70ch;
	}
	.prop {
		padding: 18px 20px;
		margin-bottom: 20px;
		scroll-margin-top: 16px;
	}
	.prop:target {
		box-shadow: 0 0 0 2px var(--mark);
	}
	.ph {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.right {
		text-align: right;
	}
	.pt {
		margin: 14px 0 6px;
		font-size: 18px;
	}
	.old {
		color: var(--faint);
		text-decoration: line-through;
		font-weight: 400;
		margin-right: 6px;
	}
	.why {
		margin: 0 0 14px;
		padding: 0 0 0 14px;
		border-left: 3px solid var(--claude);
		font-family: var(--serif);
		font-size: 16px;
		font-style: italic;
		color: var(--graphite);
	}
	.warn {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		margin: 0 0 12px;
		padding: 8px 12px;
		border-radius: var(--r-sm);
		background: var(--mark-wash);
		color: var(--mark-ink);
	}
	.warn :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.decide {
		display: flex;
		gap: 8px;
		margin-top: 14px;
	}
	.decide input {
		flex: 1;
	}
	.done-h {
		margin-top: 40px;
	}
	.done {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-top: 1px solid var(--rule);
	}
	.done:first-child {
		border-top: 0;
	}
	@media (max-width: 700px) {
		.page {
			padding: 24px 16px 48px;
		}
		.decide {
			flex-wrap: wrap;
		}
		.decide input {
			flex-basis: 100%;
		}
	}
</style>
