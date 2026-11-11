<script lang="ts">
	import type { PageProps } from './$types';
	import { fmt, kindLabel, viaLabel } from '../../../lib/ui';
	let { data, form }: PageProps = $props();
	const b = $derived(data.brief);
	const base = $derived(`/p/${b.project.id}`);
	const changes = $derived(b.changesSinceLastVisit);
</script>

<svelte:head><title>{b.project.name} – Közös tervező</title></svelte:head>

{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

<div class="grid">
	<section>
		<h2>Dokumentumok</h2>
		{#each b.documents as d (d.id)}
			<div class="doc">
				<a href={`${base}/d/${d.id}`}><strong>{d.title}</strong></a>
				<span class="badge">{kindLabel(d.kind)}</span>
				{#if d.isProtected}<span class="badge prot">védett</span>{/if}
				<ul class="secs">
					{#each d.sections as s (s.id)}
						<li>
							<a href={`${base}/d/${d.id}#s-${s.id}`}>{s.title}</a>
							<span class="muted small">rev {s.revision}</span>
							{#if s.lock}<span class="badge lock">🔒 {s.lock.heldBy}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<p class="muted">Még nincs dokumentum.</p>
		{/each}
		{#if data.role !== 'viewer'}
			<form method="POST" action="?/createDocument" class="row">
				<input name="title" placeholder="Új dokumentum címe" required />
				<select name="kind">
					<option value="note">jegyzet</option>
					<option value="research">kutatás</option>
					<option value="main_plan">fő terv (védett)</option>
				</select>
				<button class="button secondary">Létrehozás</button>
			</form>
		{/if}
	</section>

	<aside>
		{#if b.openProposals.length}
			<h2>Nyitott javaslatok</h2>
			<ul>
				{#each b.openProposals as p (p.id)}
					<li><a href={`${base}/proposals#p-${p.id}`}>{p.newSection ? 'Új szakasz' : p.sectionTitle}: {p.title}</a><br /><span class="muted small">{p.by} ({viaLabel(p.via)}) – {p.reason}</span></li>
				{/each}
			</ul>
		{/if}
		{#if b.activeLocks.length}
			<h2>Ki min dolgozik most</h2>
			<ul>
				{#each b.activeLocks as l (l.sectionId)}
					<li>🔒 <strong>{l.heldBy}</strong> ({viaLabel(l.via)}): {l.sectionTitle}{l.purpose ? ` – ${l.purpose}` : ''}<br /><span class="muted small">{fmt(l.expiresAt)}-ig</span></li>
				{/each}
			</ul>
		{/if}
		{#if b.openQuestions.length}
			<h2>Nyitott kérdések</h2>
			<ul>
				{#each b.openQuestions as q (q.id)}
					<li><a href={`${base}/questions#q-${q.id}`}>{q.title}</a>{#if q.status === 'disputed'} <span class="badge warn">vitatott</span>{/if}</li>
				{/each}
			</ul>
		{/if}
		<h2>Változások, mióta itt voltál</h2>
		{#if changes.items.length}
			<ul class="changes">
				{#each [...changes.items].reverse() as e (e.id)}
					<li><span class="muted small">{fmt(e.at)}</span><br /><strong>{e.by}</strong> <span class="badge">{viaLabel(e.via)}</span> {e.summary}</li>
				{/each}
			</ul>
			{#if changes.hasMore}<p class="muted small">…és még több.</p>{/if}
		{:else}
			<p class="muted">Nincs új változás a többiektől{changes.lastVisitedAt ? ` (utoljára: ${fmt(changes.lastVisitedAt)})` : ''}.</p>
		{/if}
	</aside>
</div>

<style>
	.grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 32px; }
	@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
	.doc { margin-bottom: 16px; }
	.secs { margin: 4px 0 0; padding-left: 18px; }
	.changes { list-style: none; padding: 0; }
	.changes li { padding: 6px 0; border-bottom: 1px solid var(--line); }
	aside h2:first-child { margin-top: 0; }
</style>
