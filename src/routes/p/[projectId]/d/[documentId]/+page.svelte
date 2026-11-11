<script lang="ts">
	import type { PageProps } from './$types';
	import { fmt, kindLabel, viaLabel } from '../../../../../lib/ui';
	import { renderMermaid } from '../../../../../lib/mermaid';
	let { data, form }: PageProps = $props();
	const d = $derived(data.doc);
	const base = $derived(`/p/${d.projectId}`);
	const canEdit = $derived(data.role !== 'viewer');
	const failedId = $derived((form as { sectionId?: string } | null)?.sectionId ?? null);
	const editing = $derived(failedId ?? data.editId);
	const draft = $derived((form as { draft?: { title: string; content: string; reason: string } } | null)?.draft);
	const details = $derived((form as { details?: Record<string, unknown> } | null)?.details);

	let container: HTMLElement;
	$effect(() => {
		void d; // minden adatfrissítés után újra
		renderMermaid(container);
	});
</script>

<svelte:head><title>{d.title} – Közös tervező</title></svelte:head>

<div class="dochead">
	<h2>{d.title}</h2>
	<span class="badge">{kindLabel(d.kind)}</span>
	{#if d.isProtected}<span class="badge prot">védett – a Claude ide csak javasolhat</span>{/if}
	{#if d.openNewSectionProposals}<a class="badge warn" href={`${base}/proposals`}>{d.openNewSectionProposals} új szakasz javasolva</a>{/if}
</div>

{#if form?.error && !failedId}<p class="error">{form.error}</p>{/if}

<nav class="toc">
	{#each d.sections as s (s.id)}<a href={`#s-${s.id}`}>{s.title}</a>{/each}
</nav>

<div bind:this={container}>
	{#each d.sections as s (s.id)}
		<article id={`s-${s.id}`} class="section">
			<div class="shead">
				<h3>{s.title}</h3>
				<span class="muted small">rev {s.revision} · {fmt(s.updatedAt)}</span>
				{#if s.lock}
					<span class="badge lock" title={s.lock.purpose}>🔒 {s.lock.heldBy} ({viaLabel(s.lock.via)}) {fmt(s.lock.expiresAt)}-ig{s.lock.purpose ? ` – ${s.lock.purpose}` : ''}</span>
					{#if data.role === 'owner'}
						<form method="POST" action="?/unlock" class="inline"><input type="hidden" name="sectionId" value={s.id} /><button class="link danger">zár feloldása</button></form>
					{/if}
				{/if}
				{#if s.openProposals}<a class="badge warn" href={`${base}/proposals`}>{s.openProposals} javaslat</a>{/if}
				<span class="spacer"></span>
				<a class="small" href={`${base}/s/${s.id}/history`}>előzmény</a>
				{#if canEdit && editing !== s.id}<a class="small" href={`?edit=${s.id}#s-${s.id}`}>szerkesztés</a>{/if}
			</div>

			{#if editing === s.id && canEdit}
				{#if failedId === s.id && form?.error}
					<div class="error box">
						<p><strong>{form.error}</strong></p>
						{#if details?.diff}<p>Mi változott közben:</p><pre class="diff">{details.diff}</pre>{/if}
						{#if details?.currentContent !== undefined}
							<details><summary>A mostani tartalom (rev {details.currentRevision})</summary><pre>{details.currentContent}</pre></details>
							<p class="small">A te változatod lent van. Építsd bele a friss tartalmat, és mentsd újra – vagy töltsd be a friss változatot: <a href={`?edit=${s.id}#s-${s.id}`}>újratöltés</a>.</p>
						{/if}
					</div>
				{/if}
				<form method="POST" action="?/save" class="editor" data-editing="true">
					<input type="hidden" name="sectionId" value={s.id} />
					<input type="hidden" name="baseRevision" value={failedId === s.id && details?.currentRevision ? details.currentRevision : s.revision} />
					<input name="title" value={draft?.title ?? s.title} />
					<textarea name="content" rows="18">{draft?.content ?? s.content}</textarea>
					<div class="row">
						<input name="reason" placeholder="Miért változtatsz? (a többiek látják)" value={draft?.reason ?? ''} class="grow" />
						<button class="button">Mentés</button>
						<a class="button secondary" href={`${base}/d/${d.id}#s-${s.id}`}>Mégse</a>
					</div>
				</form>
				<form method="POST" action="?/trash" class="inline" onsubmit={(e) => { if (!confirm('Lomtárba teszed a szakaszt? (Az előzményből visszaállítható.)')) e.preventDefault(); }}>
					<input type="hidden" name="sectionId" value={s.id} /><input type="hidden" name="baseRevision" value={s.revision} />
					<button class="link danger small">Szakasz lomtárba</button>
				</form>
			{:else}
				<div class="md">{@html s.html}</div>
			{/if}

			<div class="comments">
				{#each s.comments as c (c.id)}
					<div class="comment">
						<p><strong>{c.by}</strong> <span class="badge">{viaLabel(c.via)}</span> <span class="muted small">{fmt(c.createdAt)}</span></p>
						<p class="pre">{c.body}</p>
						{#each c.replies as r (r.id)}
							<div class="reply"><p><strong>{r.by}</strong> <span class="badge">{viaLabel(r.via)}</span> <span class="muted small">{fmt(r.createdAt)}</span></p><p class="pre">{r.body}</p></div>
						{/each}
						<form method="POST" action="?/comment" class="row">
							<input type="hidden" name="sectionId" value={s.id} /><input type="hidden" name="parentId" value={c.id} />
							<input name="body" placeholder="Válasz…" class="grow" required /><button class="link">Válasz</button>
						</form>
						{#if canEdit}
							<form method="POST" action="?/resolveComment" class="inline"><input type="hidden" name="commentId" value={c.id} /><input type="hidden" name="sectionId" value={s.id} /><button class="link small">szál lezárása</button></form>
						{/if}
					</div>
				{/each}
				<details>
					<summary class="small muted">Megjegyzés</summary>
					<form method="POST" action="?/comment" class="row">
						<input type="hidden" name="sectionId" value={s.id} />
						<input name="body" placeholder="Megjegyzés ehhez a szakaszhoz…" class="grow" required /><button class="link">Küldés</button>
					</form>
				</details>
			</div>
		</article>
	{:else}
		<p class="muted">A dokumentum üres.</p>
	{/each}
</div>

{#if canEdit}
	<details class="newsec" open={data.newAfter !== null}>
		<summary>+ Új szakasz</summary>
		<form method="POST" action="?/create" class="editor" data-editing="true">
			<input name="title" placeholder="Cím" required />
			<textarea name="content" rows="8" placeholder="Markdown…"></textarea>
			<div class="row">
				<select name="afterSectionId">
					<option value="">a végére</option>
					{#each d.sections as s (s.id)}<option value={s.id}>„{s.title}” után</option>{/each}
				</select>
				<input name="reason" placeholder="Miért?" class="grow" />
				<button class="button">Létrehozás</button>
			</div>
		</form>
	</details>
{/if}

<style>
	.dochead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.dochead h2 { margin: 0; }
	.toc { display: flex; gap: 6px 14px; flex-wrap: wrap; margin: 12px 0 8px; font-size: 0.9em; }
	.section { border-top: 1px solid var(--line); padding: 14px 0 6px; }
	.shead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
	.shead h3 { margin: 0; }
	.spacer { flex: 1; }
	.editor { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
	.editor textarea { font: 13px/1.5 ui-monospace, monospace; width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); }
	.grow { flex: 1; min-width: 200px; }
	.box { border: 1px solid var(--danger); border-radius: 8px; padding: 8px 12px; }
	.comments { margin: 6px 0 0 0; }
	.comment { border-left: 3px solid var(--line); padding: 2px 10px; margin: 8px 0; }
	.comment p { margin: 2px 0; }
	.reply { margin-left: 14px; }
	.pre { white-space: pre-wrap; }
	.newsec { margin-top: 24px; }
</style>
