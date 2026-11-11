<script lang="ts">
	import type { PageProps } from './$types';
	import Diff from '../../../../../../lib/Diff.svelte';
	import { fmt, viaLabel } from '../../../../../../lib/ui';
	let { data, form }: PageProps = $props();
	const s = $derived(data.section);
	const kindLabel = (k: string) =>
		({ create: 'létrehozás', edit: 'módosítás', replace: 'átírás', restore: 'visszaállítás', proposal: 'elfogadott javaslat', trash: 'lomtárba', untrash: 'visszahozva' })[k] ?? k;
</script>

<svelte:head><title>Előzmény: {s.title}</title></svelte:head>

<p><a href={`/p/${data.project.id}/d/${s.documentId}#s-${s.id}`}>← {s.documentTitle}</a></p>
<h2>Előzmény: {s.title} {#if s.inTrash}<span class="badge warn">lomtárban</span>{/if}</h2>
{#if form?.error}<p class="error">{form.error}</p>{/if}

<table>
	<thead><tr><th>Rev</th><th>Mi</th><th>Ki</th><th>Mikor</th><th>Miért</th><th></th></tr></thead>
	<tbody>
		{#each data.revisions as r (r.revision)}
			<tr class:sel={r.revision === data.a || r.revision === data.b}>
				<td>{r.revision}</td>
				<td>{kindLabel(r.kind)}</td>
				<td>{r.by} <span class="badge">{viaLabel(r.via)}</span></td>
				<td class="small">{fmt(r.createdAt)}</td>
				<td class="small">{r.reason}</td>
				<td class="small nowrap">
					{#if r.revision > 1}<a href={`?a=${r.revision - 1}&b=${r.revision}`}>mi változott</a>{/if}
					{#if r.revision !== s.revision && data.role !== 'viewer'}
						<form method="POST" action="?/restore" class="inline" onsubmit={(e) => { if (!confirm(`Visszaállítod a ${r.revision}. revízió tartalmát? (Új revízióként, semmi nem vész el.)`)) e.preventDefault(); }}>
							<input type="hidden" name="toRevision" value={r.revision} /><input type="hidden" name="baseRevision" value={s.revision} />
							<button class="link">visszaállítás</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<h3>Különbség: rev {data.a} → rev {data.b}</h3>
{#if data.cmp.from.title !== data.cmp.to.title}<p class="small">Cím: „{data.cmp.from.title}” → „{data.cmp.to.title}”</p>{/if}
<Diff lines={data.cmp.diff} />

<style>
	tr.sel td { background: color-mix(in srgb, var(--accent) 8%, transparent); }
	.nowrap { white-space: nowrap; }
</style>
