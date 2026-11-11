<script lang="ts">
	import type { PageProps } from './$types';
	import Diff from '../../../../lib/Diff.svelte';
	import { fmt, viaLabel } from '../../../../lib/ui';
	let { data, form }: PageProps = $props();
	const base = $derived(`/p/${data.project.id}`);
	const canDecide = $derived(data.role !== 'viewer');
</script>

<svelte:head><title>Javaslatok – {data.project.name}</title></svelte:head>

{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

<h2>Nyitott javaslatok</h2>
{#each data.open as p (p.id)}
	<article id={`p-${p.id}`} class="prop">
		<p>
			<strong>{p.newSection ? `Új szakasz: ${p.title}` : p.titleChanged ? `${p.baseTitle} → ${p.title}` : p.title}</strong>
			<span class="muted">· <a href={`${base}/d/${p.documentId}${p.sectionId ? `#s-${p.sectionId}` : ''}`}>{p.documentTitle}</a></span>
		</p>
		<p class="small"><strong>{p.by}</strong> <span class="badge">{viaLabel(p.via)}</span> <span class="muted">{fmt(p.createdAt)}</span></p>
		<p class="reason">„{p.reason}”</p>
		{#if p.status === 'conflicted' || p.stale}
			<p class="error small">A szakasz a javaslat óta megváltozott (rev {p.baseRevision} → {p.currentRevision}), ezért így nem fogadható el. Kérd meg a Claude-ot, hogy alapozza újra, vagy utasítsd el.</p>
		{/if}
		<Diff lines={p.diff} />
		{#if canDecide}
			<form method="POST" class="row">
				<input type="hidden" name="proposalId" value={p.id} />
				<input name="note" placeholder="Megjegyzés (nem kötelező)" class="grow" />
				{#if p.status === 'open' && !p.stale}<button class="button" formaction="?/accept">Elfogadom</button>{/if}
				<button class="button secondary" formaction="?/reject">Elutasítom</button>
			</form>
		{/if}
	</article>
{:else}
	<p class="muted">Nincs nyitott javaslat.</p>
{/each}

{#if data.resolved.length}
	<h2>Legutóbb lezárt</h2>
	<ul>
		{#each data.resolved as p (p.id)}
			<li>
				<span class="badge {p.status === 'accepted' ? 'okb' : ''}">{p.status === 'accepted' ? 'elfogadva' : 'elutasítva'}</span>
				{p.title} <span class="muted small">({p.by}, {fmt(p.resolvedAt)}){p.resolutionNote ? ` – ${p.resolutionNote}` : ''}</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.prop { border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 12px 0; background: var(--card); }
	.prop p { margin: 4px 0; }
	.reason { font-style: italic; }
	.grow { flex: 1; min-width: 200px; }
	form.row { margin-top: 8px; }
</style>
