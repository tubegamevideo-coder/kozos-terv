<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { History, Lock, MessageSquare, PenLine, Plus, ShieldCheck, Trash2, GitPullRequestArrow } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Avatar from '../../../../../../lib/components/Avatar.svelte';
	import Author from '../../../../../../lib/components/Author.svelte';
	import Empty from '../../../../../../lib/components/Empty.svelte';
	import { renderMermaid } from '../../../../../../lib/mermaid';
	import { withToast } from '../../../../../../lib/toast.svelte';
	import { ago, kindLabel } from '../../../../../../lib/ui';

	let { data, form }: PageProps = $props();
	const d = $derived(data.doc);
	const base = $derived(`/p/${d.projectId}`);
	const docUrl = $derived(`${base}/d/${d.id}`);
	const canEdit = $derived(data.role !== 'viewer');
	const f = $derived(form as null | {
		error?: string;
		code?: string;
		sectionId?: string;
		draft?: { title: string; content: string; reason: string };
		details?: { diff?: string; currentContent?: string; currentRevision?: number; heldBy?: string; expiresAt?: string };
	});
	const failedId = $derived(f?.sectionId ?? null);
	const editing = $derived(failedId ?? data.editId);
	let openComments = $state<Record<string, boolean>>({});
	let adding = $state(false);
	let saving = $state(false);

	let container = $state<HTMLElement>();
	$effect(() => {
		void d;
		renderMermaid(container);
	});

	const minutesLeft = (iso: string) => Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
	const diffClass = (l: string) => (l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '');

	function autosize(el: HTMLTextAreaElement) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = Math.min(el.scrollHeight + 4, window.innerHeight * 0.7) + 'px';
		};
		fit();
		el.addEventListener('input', fit);
		return { destroy: () => el.removeEventListener('input', fit) };
	}
	const saveEnhance = () => {
		saving = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			saving = false;
			await update({ reset: false });
		};
	};
</script>

<svelte:head><title>{d.title} – Közös tervező</title></svelte:head>

<div class="doc-page">
	<div class="doc" bind:this={container}>
		<header class="dhead">
			<p class="kind faint small">{kindLabel(d.kind)}</p>
			<h1>{d.title}</h1>
			{#if d.isProtected}
				<p class="protected small">
					<ShieldCheck size={15} />
					<span>Védett dokumentum. A Claude-ok ide csak javaslatot tehetnek, amit itt, a <a href={`${base}/proposals`}>Jóváhagyásra vár</a> oldalon fogadsz el. Te közvetlenül is szerkesztheted.</span>
				</p>
			{/if}
			{#if d.openNewSectionProposals}
				<a class="pending-new small" href={`${base}/proposals`}><GitPullRequestArrow size={14} /> {d.openNewSectionProposals} új szakaszt javasoltak ebbe a dokumentumba</a>
			{/if}
		</header>

		{#if f?.error && !failedId}<p class="err small">{f.error}</p>{/if}

		{#each d.sections as s (s.id)}
			<article id={`s-${s.id}`} class="sec" class:locked={!!s.lock} class:claude-lock={s.lock?.via === 'claude'} class:is-editing={editing === s.id}>
				<aside class="margin" aria-label="Szerzőség">
					{#if s.lastEdit}
						<Avatar name={s.lastEdit.by} claude={s.lastEdit.via === 'claude'} size={26} />
						<p class="who">{s.lastEdit.by}</p>
						{#if s.lastEdit.via === 'claude'}<p class="cl">Claude-ja</p>{/if}
						<p class="when faint">{ago(s.lastEdit.at)}</p>
					{/if}
					<a class="rev faint" href={`${base}/s/${s.id}/history`} title="Előzmény">{s.revision}. változat</a>
				</aside>

				<div class="body">
					{#if s.lock}
						<div class="lockline">
							<span class="pulse"></span>
							<span class="grow"><strong>{s.lock.heldBy}{s.lock.via === 'claude' ? ' Claude-ja' : ''}</strong> dolgozik rajta{s.lock.purpose ? `: ${s.lock.purpose}` : ''}. Még {minutesLeft(s.lock.expiresAt)} percig zárolva, addig csak megjegyzést lehet írni.</span>
							{#if data.role === 'owner'}
								<form method="POST" action="?/unlock" use:enhance={withToast()}>
									<input type="hidden" name="sectionId" value={s.id} />
									<button class="btn ghost sm" title="A tulajdonos feloldhatja, ha a zár beragadt">Feloldás</button>
								</form>
							{/if}
						</div>
					{/if}

					<div class="stitle">
						<h2>{s.title}</h2>
						{#if s.openProposals}<a class="tag mark" href={`${base}/proposals`}><GitPullRequestArrow size={12} /> {s.openProposals} javaslat vár</a>{/if}
						<div class="tools">
							<button class="btn ghost sm" onclick={() => (openComments[s.id] = !openComments[s.id])} aria-expanded={!!openComments[s.id]}>
								<MessageSquare size={14} />{s.comments.length ? ` ${s.comments.length}` : ''}<span class="sr-only">Megjegyzések</span>
							</button>
							<a class="btn ghost sm" href={`${base}/s/${s.id}/history`} title="Előzmény"><History size={14} /><span class="sr-only">Előzmény</span></a>
							{#if canEdit && editing !== s.id && !(s.lock && s.lock.heldByUserId !== data.user.id)}
								<a class="btn ghost sm" href={`?edit=${s.id}#s-${s.id}`} data-sveltekit-noscroll><PenLine size={14} /><span class="lt"> Szerkesztés</span></a>
							{/if}
						</div>
					</div>

					{#if editing === s.id && canEdit}
						{#if failedId === s.id && f?.error}
							<div class="conflict">
								<p><strong>{f.error}</strong></p>
								{#if f.details?.diff}
									<p class="small">Ez változott, mióta megnyitottad:</p>
									<pre class="udiff">{#each f.details.diff.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++')) as l, i (i)}<span class={diffClass(l)}>{l}
</span>{/each}</pre>
									<p class="small">A te szövegedet megtartottuk lent. Dolgozd bele a fenti változást, és mentsd újra.</p>
								{/if}
							</div>
						{/if}
						<form method="POST" action="?/save" class="editor" data-editing="true" use:enhance={saveEnhance}>
							<input type="hidden" name="sectionId" value={s.id} />
							<input type="hidden" name="baseRevision" value={failedId === s.id && f?.details?.currentRevision ? f.details.currentRevision : s.revision} />
							<input class="etitle" name="title" value={f?.draft?.title ?? s.title} aria-label="Cím" />
							<textarea class="code" name="content" use:autosize aria-label="Tartalom (Markdown)">{f?.draft?.content ?? s.content}</textarea>
							<p class="faint tiny">Markdown: **félkövér**, - lista, | táblázat |, ```mermaid ábra```</p>
							<div class="ebar">
								<input name="reason" placeholder="Mit és miért változtattál? A többiek ezt látják az előzményben." value={f?.draft?.reason ?? ''} aria-label="Indoklás" />
								<a class="btn ghost" href={`${docUrl}#s-${s.id}`} data-sveltekit-noscroll>Mégse</a>
								<button class="btn" disabled={saving}>{saving ? 'Mentés…' : 'Mentés'}</button>
							</div>
						</form>
						<form method="POST" action="?/trash" class="trash" use:enhance={withToast()} onsubmit={(e) => { if (!confirm('Lomtárba teszed a szakaszt? Az előzményből bármikor visszaállítható.')) e.preventDefault(); }}>
							<input type="hidden" name="sectionId" value={s.id} /><input type="hidden" name="baseRevision" value={s.revision} />
							<button class="btn ghost sm"><Trash2 size={14} /> Lomtárba</button>
						</form>
					{:else}
						<div class="prose">{@html s.html}</div>
					{/if}

					{#if openComments[s.id] || (s.comments.length > 0 && page.url.hash === `#c-${s.id}`)}
						<div class="thread" id={`c-${s.id}`}>
							{#each s.comments as c (c.id)}
								<div class="cmt">
									<Author name={c.by} via={c.via} size={20} />
									<span class="faint tiny">{ago(c.createdAt)}</span>
									<p class="cbody">{c.body}</p>
									{#each c.replies as r (r.id)}
										<div class="reply">
											<Author name={r.by} via={r.via} size={18} /> <span class="faint tiny">{ago(r.createdAt)}</span>
											<p class="cbody">{r.body}</p>
										</div>
									{/each}
									<div class="cactions">
										<form method="POST" action="?/comment" class="grow reply-form" use:enhance={withToast()}>
											<input type="hidden" name="sectionId" value={s.id} /><input type="hidden" name="parentId" value={c.id} />
											<input name="body" placeholder="Válasz" required aria-label="Válasz" />
										</form>
										{#if canEdit}
											<form method="POST" action="?/resolveComment" use:enhance={withToast()}>
												<input type="hidden" name="commentId" value={c.id} /><input type="hidden" name="sectionId" value={s.id} />
												<button class="btn ghost sm">Lezárás</button>
											</form>
										{/if}
									</div>
								</div>
							{/each}
							<form method="POST" action="?/comment" class="newc" use:enhance={withToast()}>
								<input type="hidden" name="sectionId" value={s.id} />
								<input name="body" placeholder={s.lock ? 'A szakasz zárolva van, de megjegyzést írhatsz' : 'Megjegyzés ehhez a szakaszhoz'} required aria-label="Megjegyzés" />
								<button class="btn quiet sm">Küldés</button>
							</form>
						</div>
					{/if}
				</div>
			</article>
		{:else}
			<Empty title="A dokumentum még üres">Adj hozzá egy szakaszt lent, vagy kérd meg a Claude-odat, hogy írjon bele.</Empty>
		{/each}

		{#if canEdit}
			{#if adding}
				<form method="POST" action="?/create" class="editor newsec" data-editing="true" use:enhance={withToast({ onDone: () => (adding = false) })}>
					<input class="etitle" name="title" placeholder="Az új szakasz címe" required aria-label="Cím" />
					<textarea class="code" name="content" rows="6" placeholder="Markdown…" use:autosize aria-label="Tartalom"></textarea>
					<div class="ebar">
						<select name="afterSectionId" aria-label="Hova kerüljön">
							<option value="">A dokumentum végére</option>
							{#each d.sections as s (s.id)}<option value={s.id}>„{s.title}” után</option>{/each}
						</select>
						<input name="reason" placeholder="Miért kell ez a szakasz?" aria-label="Indoklás" />
						<button type="button" class="btn ghost" onclick={() => (adding = false)}>Mégse</button>
						<button class="btn">Hozzáadás</button>
					</div>
				</form>
			{:else}
				<button class="addsec" onclick={() => (adding = true)}><Plus size={16} /> Új szakasz</button>
			{/if}
		{/if}
	</div>

	<nav class="outline" aria-label="Tartalom">
		<p class="faint small oh">Ebben a dokumentumban</p>
		{#each d.sections as s (s.id)}
			<a href={`#s-${s.id}`} class:hasLock={!!s.lock}>
				<span class="grow">{s.title}</span>
				{#if s.lock}<Lock size={12} />{/if}
				{#if s.openProposals}<span class="pdot" title="Javaslat vár"></span>{/if}
			</a>
		{/each}
	</nav>
</div>

<style>
	.doc-page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: 40px;
		max-width: 1180px;
		padding: 36px 40px 96px;
	}
	.doc {
		min-width: 0;
	}
	.dhead {
		margin: 0 0 28px 150px;
		max-width: 720px;
	}
	.kind {
		margin: 0 0 4px;
	}
	.dhead h1 {
		font-size: 30px;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}
	.protected {
		display: flex;
		gap: 8px;
		margin: 14px 0 0;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--teal-wash);
		color: var(--ink);
	}
	.protected :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--teal);
	}
	.pending-new {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		padding: 4px 10px;
		border-radius: var(--r-sm);
		background: var(--mark-wash);
		color: var(--mark-ink);
	}
	.err {
		margin-left: 150px;
		color: var(--danger);
	}

	/* A szakasz: bal oldali szerzőségi margó + olvasóoszlop */
	.sec {
		display: grid;
		grid-template-columns: 126px minmax(0, 720px);
		gap: 24px;
		padding: 18px 0 22px;
		border-top: 1px solid var(--rule);
		scroll-margin-top: 16px;
	}
	.margin {
		padding-top: 4px;
		text-align: right;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: 12px;
		line-height: 1.35;
	}
	.margin :global(.av) {
		margin-bottom: 6px;
	}
	.who {
		margin: 0;
		font-weight: 500;
		color: var(--ink);
	}
	.cl {
		margin: 0;
		color: var(--claude);
		font-weight: 500;
	}
	.when,
	.rev {
		margin: 0;
	}
	.rev:hover {
		color: var(--teal);
	}
	.body {
		min-width: 0;
		position: relative;
	}
	/* Élő zár: a szakasz körül körvonal, ibolya ha Claude dolgozik rajta */
	.sec.locked .body {
		padding: 12px 14px;
		margin: -12px -14px;
		border-radius: var(--r-md);
		box-shadow: 0 0 0 1.5px var(--teal);
	}
	.sec.claude-lock .body {
		box-shadow: 0 0 0 1.5px var(--claude);
	}
	.lockline {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 0 12px;
		font-size: 13px;
		color: var(--graphite);
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--teal);
		flex: none;
		animation: pulse 1.8s ease-in-out infinite;
	}
	.claude-lock .pulse {
		background: var(--claude);
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
	.stitle {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 10px;
	}
	.stitle h2 {
		flex: 1;
		font-size: 20px;
		letter-spacing: -0.015em;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0.35;
		transition: opacity 0.12s;
	}
	.sec:hover .tools,
	.sec:focus-within .tools,
	.sec.is-editing .tools {
		opacity: 1;
	}
	@media (hover: none) {
		.tools {
			opacity: 1;
		}
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.etitle {
		font-weight: 600;
		font-size: 16px;
	}
	.ebar {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.ebar input {
		flex: 1;
	}
	.ebar select {
		width: auto;
	}
	.trash {
		margin-top: 6px;
	}
	.conflict {
		margin-bottom: 12px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--danger-wash);
	}
	.conflict p {
		margin: 0 0 6px;
	}
	.udiff {
		margin: 0 0 8px;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 12.5px;
		line-height: 1.55;
		white-space: pre-wrap;
		max-height: 300px;
		overflow: auto;
	}
	.udiff .add {
		color: var(--add-ink);
		background: var(--add);
	}
	.udiff .del {
		color: var(--del-ink);
		background: var(--del);
	}
	.udiff .hunk {
		color: var(--faint);
	}
	.thread {
		margin-top: 14px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--sunken);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.cmt {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
	}
	.cbody {
		flex-basis: 100%;
		margin: 2px 0 0 28px;
		white-space: pre-wrap;
		font-size: 14px;
	}
	.reply {
		flex-basis: 100%;
		margin: 6px 0 0 28px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
	}
	.reply .cbody {
		margin-left: 26px;
	}
	.cactions {
		flex-basis: 100%;
		display: flex;
		gap: 6px;
		margin-left: 28px;
	}
	.reply-form input {
		height: 30px;
		padding: 4px 8px;
		font-size: 13px;
	}
	.newc {
		display: flex;
		gap: 8px;
	}
	.addsec {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: calc(100% - 150px);
		max-width: 720px;
		margin: 20px 0 0 150px;
		height: 44px;
		border: 1px dashed var(--rule-strong);
		border-radius: var(--r-md);
		background: none;
		color: var(--graphite);
		cursor: pointer;
	}
	.addsec:hover {
		border-color: var(--teal);
		color: var(--teal);
	}
	.newsec {
		margin: 20px 0 0 150px;
		max-width: 720px;
	}

	.outline {
		position: sticky;
		top: 24px;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-height: calc(100vh - 48px);
		overflow-y: auto;
		padding-top: 52px;
	}
	.oh {
		margin: 0 0 8px;
		font-weight: 600;
	}
	.outline a {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border-left: 2px solid var(--rule);
		color: var(--graphite);
		font-size: 13px;
		line-height: 1.35;
	}
	.outline a:hover {
		color: var(--ink);
		border-left-color: var(--faint);
		text-decoration: none;
	}
	.outline a.hasLock {
		border-left-color: var(--claude);
	}
	.outline a :global(svg) {
		color: var(--claude);
		flex: none;
	}
	.pdot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--mark);
		flex: none;
	}

	@media (max-width: 1100px) {
		.doc-page {
			grid-template-columns: 1fr;
		}
		.outline {
			display: none;
		}
	}
	@media (max-width: 760px) {
		.doc-page {
			padding: 20px 16px 72px;
		}
		.dhead,
		.err,
		.newsec {
			margin-left: 0;
		}
		.addsec {
			margin-left: 0;
			width: 100%;
		}
		.sec {
			grid-template-columns: 1fr;
			gap: 8px;
		}
		.margin {
			flex-direction: row;
			align-items: center;
			justify-content: flex-start;
			gap: 6px;
			order: 2;
		}
		.margin :global(.av) {
			margin: 0;
		}
		.ebar {
			flex-wrap: wrap;
		}
		.stitle {
			flex-wrap: wrap;
		}
		.stitle h2 {
			flex-basis: 100%;
		}
		.lt {
			display: none;
		}
	}
</style>
