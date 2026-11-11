<script lang="ts">
	import { enhance } from '$app/forms';
	import { ArrowLeft, RotateCcw } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Diff from '../../../../../../../lib/Diff.svelte';
	import Author from '../../../../../../../lib/components/Author.svelte';
	import { withToast } from '../../../../../../../lib/toast.svelte';
	import { fmt } from '../../../../../../../lib/ui';
	let { data }: PageProps = $props();
	const s = $derived(data.section);
	const what = (k: string) =>
		({ create: 'létrehozta', edit: 'módosította', replace: 'átírta', restore: 'visszaállította', proposal: 'javaslata elfogadva', trash: 'lomtárba tette', untrash: 'visszahozta' })[k] ?? k;
</script>

<svelte:head><title>Előzmény: {s.title}</title></svelte:head>

<div class="page">
	<a class="back small" href={`/p/${data.project.id}/d/${s.documentId}#s-${s.id}`}><ArrowLeft size={14} /> {s.documentTitle}</a>
	<h1 class="page-title">{s.title}</h1>
	<p class="muted lead">A szakasz minden változata megmarad. Válassz ki egyet, hogy lásd, mi változott benne, vagy állítsd vissza – a visszaállítás is új változatként kerül be.{#if s.inTrash} <span class="tag danger">Lomtárban</span>{/if}</p>

	<div class="layout">
		<ol class="timeline" reversed>
			{#each data.revisions as r (r.revision)}
				<li class:sel={r.revision === data.b}>
					<a class="rv" href={`?a=${Math.max(1, r.revision - 1)}&b=${r.revision}`} data-sveltekit-noscroll>
						<span class="num">{r.revision}.</span>
						<span class="grow">
							<Author name={r.by} via={r.via} size={18} short />
							<span class="muted small"> {what(r.kind)}</span>
							{#if r.reason}<span class="reason small">{r.reason}</span>{/if}
							<span class="faint tiny">{fmt(r.createdAt)}</span>
						</span>
					</a>
					{#if r.revision !== s.revision && data.role !== 'viewer'}
						<form method="POST" action="?/restore" use:enhance={withToast()} onsubmit={(e) => { if (!confirm(`Visszaállítod a(z) ${r.revision}. változatot?`)) e.preventDefault(); }}>
							<input type="hidden" name="toRevision" value={r.revision} /><input type="hidden" name="baseRevision" value={s.revision} />
							<button class="btn ghost sm" title="Visszaállítás erre a változatra"><RotateCcw size={14} /><span class="sr-only">Visszaállítás</span></button>
						</form>
					{/if}
				</li>
			{/each}
		</ol>

		<div class="cmp">
			<p class="small muted ch">{data.a}. → {data.b}. változat{#if data.cmp.from.title !== data.cmp.to.title}, cím: „{data.cmp.from.title}” → „{data.cmp.to.title}”{/if}</p>
			<Diff lines={data.cmp.diff} />
		</div>
	</div>
</div>

<style>
	.page {
		max-width: 1120px;
		padding: 28px 40px 64px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--graphite);
		margin-bottom: 12px;
	}
	.lead {
		margin: 6px 0 24px;
		max-width: 72ch;
	}
	.layout {
		display: grid;
		grid-template-columns: 340px minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 2px solid var(--rule);
	}
	.timeline li {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		margin-left: -2px;
		border-left: 2px solid transparent;
	}
	.timeline li.sel {
		border-left-color: var(--teal);
		background: var(--surface);
	}
	.rv {
		flex: 1;
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		color: var(--ink);
	}
	.rv:hover {
		text-decoration: none;
		background: var(--sunken);
	}
	.rv .grow {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.num {
		font-variant-numeric: tabular-nums;
		color: var(--faint);
		width: 22px;
		text-align: right;
	}
	.reason {
		color: var(--ink);
	}
	.timeline form {
		padding-top: 8px;
	}
	.ch {
		margin: 0 0 8px;
	}
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.page {
			padding: 20px 16px 48px;
		}
	}
</style>
