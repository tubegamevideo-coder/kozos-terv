<script lang="ts">
	import type { PageProps } from './$types';
	import { fmt, kindLabel } from '../../../../lib/ui';
	let { data, form }: PageProps = $props();
	const base = $derived(`/p/${data.project.id}`);
</script>

<svelte:head><title>Beállítások – {data.project.name}</title></svelte:head>

{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

<h2>Projektutasítás a Claude-oknak</h2>
<p class="muted small">Minden Claude a beszélgetés elején megkapja (get_project_brief), és betartja. Csak ember módosíthatja.</p>
<form method="POST" action="?/instructions" class="col" data-editing="true">
	<textarea name="instructions" rows="8" disabled={data.role === 'viewer'}>{data.instructions}</textarea>
	{#if data.role !== 'viewer'}<button class="button">Mentés</button>{/if}
</form>

<h2>Dokumentumok védettsége</h2>
<p class="muted small">Védett dokumentumba a Claude csak javaslatot tehet. Állítani a munkatér tulajdonosa tud.</p>
<table>
	<tbody>
		{#each data.docs as d (d.id)}
			<tr>
				<td><a href={`${base}/d/${d.id}`}>{d.title}</a> <span class="badge">{kindLabel(d.kind)}</span></td>
				<td>{d.isProtected ? 'védett' : 'szabad'}</td>
				<td>
					{#if data.role === 'owner'}
						<form method="POST" action="?/protect" class="inline">
							<input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="value" value={d.isProtected ? '0' : '1'} />
							<button class="link">{d.isProtected ? 'védettség kikapcsolása' : 'védetté tétel'}</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<h2>Lomtár</h2>
{#if data.trashed.length}
	<ul>
		{#each data.trashed as t (t.id)}
			<li>{t.title} <span class="muted small">({t.documentTitle}, {fmt(t.deletedAt)})</span> – <a href={`${base}/s/${t.id}/history`}>előzmény és visszaállítás</a></li>
		{/each}
	</ul>
{:else}
	<p class="muted">Üres.</p>
{/if}

<style>
	.col { display: flex; flex-direction: column; gap: 8px; max-width: 760px; }
	textarea { font: 13px/1.5 ui-monospace, monospace; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); }
</style>
