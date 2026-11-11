<script lang="ts">
	import type { PageProps } from './$types';
	import { fmt, questionStatusLabel, viaLabel } from '../../../../lib/ui';
	let { data, form }: PageProps = $props();
	const canEdit = $derived(data.role !== 'viewer');
	const groups = $derived([
		{ status: 'disputed', items: data.questions.filter((q) => q.status === 'disputed') },
		{ status: 'open', items: data.questions.filter((q) => q.status === 'open') },
		{ status: 'decided', items: data.questions.filter((q) => q.status === 'decided') }
	]);
</script>

<svelte:head><title>Kérdések – {data.project.name}</title></svelte:head>

{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

{#if canEdit}
	<details>
		<summary>+ Új kérdés</summary>
		<form method="POST" action="?/add" class="col">
			<input name="title" placeholder="A kérdés" required />
			<textarea name="body" rows="3" placeholder="Háttér, lehetőségek (nem kötelező)"></textarea>
			<button class="button">Felvétel</button>
		</form>
	</details>
{/if}

{#each groups as g (g.status)}
	<h2>{questionStatusLabel(g.status)} ({g.items.length})</h2>
	{#each g.items as q (q.id)}
		<article id={`q-${q.id}`} class="q">
			<p><strong>{q.title}</strong> <span class="muted small">– {q.raisedBy} ({viaLabel(q.via)}), {fmt(q.updatedAt)}</span></p>
			{#if q.body}<p class="pre">{q.body}</p>{/if}
			{#if q.decision}<p><strong>Döntés:</strong> {q.decision}</p>{/if}
			{#each q.comments as c (c.id)}
				<div class="comment"><strong>{c.by}</strong> <span class="badge">{viaLabel(c.via)}</span> <span class="pre">{c.body}</span>
					{#each c.replies as r (r.id)}<div class="reply"><strong>{r.by}</strong> <span class="pre">{r.body}</span></div>{/each}
				</div>
			{/each}
			{#if canEdit}
				<form method="POST" action="?/comment" class="row"><input type="hidden" name="questionId" value={q.id} /><input name="body" placeholder="Hozzászólás…" class="grow" required /><button class="link">Küldés</button></form>
				<div class="row actions">
					{#each ['open', 'disputed'] as st (st)}
						{#if q.status !== st}
							<form method="POST" action="?/status" class="inline"><input type="hidden" name="questionId" value={q.id} /><input type="hidden" name="status" value={st} /><button class="link small">→ {questionStatusLabel(st)}</button></form>
						{/if}
					{/each}
					{#if q.status !== 'decided'}
						<details>
							<summary class="small">Döntés rögzítése</summary>
							<form method="POST" action="?/decide" class="col">
								<input type="hidden" name="questionId" value={q.id} />
								<input name="title" value={q.title} required />
								<input name="decision" placeholder="Mit döntöttetek?" required />
								<input name="rationale" placeholder="Miért? (nem kötelező)" />
								<button class="button">Rögzítés a döntésnaplóban</button>
							</form>
						</details>
					{/if}
				</div>
			{/if}
		</article>
	{:else}
		<p class="muted small">Nincs.</p>
	{/each}
{/each}

<style>
	.q { border-bottom: 1px solid var(--line); padding: 10px 0; }
	.q p { margin: 4px 0; }
	.col { display: flex; flex-direction: column; gap: 8px; max-width: 640px; margin: 8px 0; }
	.grow { flex: 1; min-width: 200px; }
	.pre { white-space: pre-wrap; }
	.comment { border-left: 3px solid var(--line); padding-left: 10px; margin: 6px 0; }
	.reply { margin-left: 14px; }
	.actions { align-items: baseline; gap: 12px; }
</style>
