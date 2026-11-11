<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Gavel, MessageSquare, Plus } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Author from '../../../../../lib/components/Author.svelte';
	import Empty from '../../../../../lib/components/Empty.svelte';
	import { withToast } from '../../../../../lib/toast.svelte';
	import { ago, questionStatusLabel } from '../../../../../lib/ui';
	let { data }: PageProps = $props();
	const canEdit = $derived(data.role !== 'viewer');
	const groups = $derived([
		{ status: 'disputed', hint: 'Ezekben nem értetek egyet – döntés kell.', items: data.questions.filter((q) => q.status === 'disputed') },
		{ status: 'open', hint: 'Még nyitott kérdések.', items: data.questions.filter((q) => q.status === 'open') },
		{ status: 'decided', hint: 'A döntések a döntésnaplóba is bekerülnek.', items: data.questions.filter((q) => q.status === 'decided') }
	]);
	let adding = $state(false);
	let expanded = $state<Record<string, boolean>>({});
	$effect(() => {
		const id = page.url.hash.replace('#q-', '');
		if (id) expanded[id] = true;
	});
</script>

<svelte:head><title>Kérdések – {data.project.name}</title></svelte:head>

<div class="page">
	<header class="head">
		<div class="grow">
			<h1 class="page-title">Kérdések</h1>
			<p class="muted lead">Amit még el kell dönteni. A Claude-ok is felvehetnek kérdést, ha valamit nem tudnak eldönteni helyettetek.</p>
		</div>
		{#if canEdit}<button class="btn quiet" onclick={() => (adding = !adding)}><Plus size={16} /> Új kérdés</button>{/if}
	</header>

	{#if adding}
		<form method="POST" action="?/add" class="panel newq" use:enhance={withToast({ onDone: () => (adding = false) })}>
			<input name="title" placeholder="Mit kell eldönteni?" required aria-label="Kérdés" />
			<textarea name="body" rows="3" placeholder="Háttér, lehetőségek (nem kötelező)" aria-label="Háttér"></textarea>
			<div class="row"><span class="grow"></span><button type="button" class="btn ghost" onclick={() => (adding = false)}>Mégse</button><button class="btn">Felvétel</button></div>
		</form>
	{/if}

	{#if !data.questions.length}
		<Empty title="Nincs még kérdés">Ha tervezés közben valami nyitva marad, vedd fel itt, vagy szólj a Claude-nak: „vedd fel kérdésként”.</Empty>
	{/if}

	{#each groups as g (g.status)}
		{#if g.items.length}
			<section class="grp">
				<h2 class="section-title gh">
					{questionStatusLabel(g.status)} <span class="faint">{g.items.length}</span>
				</h2>
				<p class="faint small hint">{g.hint}</p>
				<div class="panel">
					{#each g.items as q (q.id)}
						<article id={`q-${q.id}`} class="q" class:disputed={q.status === 'disputed'}>
							<button class="qh" onclick={() => (expanded[q.id] = !expanded[q.id])} aria-expanded={!!expanded[q.id]}>
								<span class="grow">
									<span class="qt">{q.title}</span>
									{#if q.decision}<span class="dec small">Döntés: {q.decision}</span>{/if}
								</span>
								{#if q.comments.length}<span class="faint small"><MessageSquare size={13} /> {q.comments.length}</span>{/if}
								<span class="faint tiny">{ago(q.updatedAt)}</span>
							</button>
							{#if expanded[q.id]}
								<div class="qb">
									<p class="small muted">Felvette: <Author name={q.raisedBy} via={q.via} size={18} short /></p>
									{#if q.body}<p class="body">{q.body}</p>{/if}
									{#each q.comments as c (c.id)}
										<div class="cmt">
											<Author name={c.by} via={c.via} size={18} />
											<p>{c.body}</p>
											{#each c.replies as r (r.id)}<div class="reply"><Author name={r.by} via={r.via} size={16} /><p>{r.body}</p></div>{/each}
										</div>
									{/each}
									{#if canEdit}
										<form method="POST" action="?/comment" class="row" use:enhance={withToast()}>
											<input type="hidden" name="questionId" value={q.id} />
											<input class="grow" name="body" placeholder="Hozzászólás" required aria-label="Hozzászólás" />
											<button class="btn quiet sm">Küldés</button>
										</form>
										<div class="acts">
											{#each ['open', 'disputed'] as st (st)}
												{#if q.status !== st}
													<form method="POST" action="?/status" use:enhance={withToast()}>
														<input type="hidden" name="questionId" value={q.id} /><input type="hidden" name="status" value={st} />
														<button class="btn ghost sm">{st === 'disputed' ? 'Vitatottnak jelölöm' : 'Újranyitom'}</button>
													</form>
												{/if}
											{/each}
										</div>
										{#if q.status !== 'decided'}
											<form method="POST" action="?/decide" class="decide" use:enhance={withToast()}>
												<input type="hidden" name="questionId" value={q.id} />
												<input type="hidden" name="title" value={q.title} />
												<label class="lbl" for={`d-${q.id}`}>Döntés</label>
												<input id={`d-${q.id}`} name="decision" placeholder="Mit döntöttetek?" required />
												<input name="rationale" placeholder="Miért? (nem kötelező)" aria-label="Indoklás" />
												<div class="row"><span class="grow faint tiny">A döntés a döntésnaplóba is bekerül.</span><button class="btn"><Gavel size={15} /> Döntés rögzítése</button></div>
											</form>
										{/if}
									{/if}
								</div>
							{/if}
						</article>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>

<style>
	.page {
		max-width: 880px;
		padding: 36px 40px 64px;
	}
	.head {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 32px;
	}
	.lead {
		margin: 6px 0 0;
	}
	.newq {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
		margin-bottom: 24px;
	}
	.grp {
		margin-bottom: 28px;
	}
	.gh {
		margin-bottom: 2px;
	}
	.hint {
		margin: 0 0 10px;
	}
	.q {
		border-top: 1px solid var(--rule);
		scroll-margin-top: 16px;
	}
	.q:first-child {
		border-top: 0;
	}
	.q.disputed {
		box-shadow: inset 3px 0 0 var(--mark);
	}
	.qh {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 16px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.qh:hover {
		background: var(--sunken);
	}
	.qh .grow {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.qt {
		font-weight: 500;
	}
	.dec {
		color: var(--teal);
	}
	.qh :global(svg) {
		vertical-align: -2px;
	}
	.qb {
		padding: 0 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.qb p {
		margin: 0;
	}
	.body {
		white-space: pre-wrap;
		font-family: var(--serif);
		font-size: 16px;
	}
	.cmt {
		padding: 8px 12px;
		border-radius: var(--r-sm);
		background: var(--sunken);
	}
	.cmt p {
		margin: 4px 0 0 26px;
		white-space: pre-wrap;
	}
	.reply {
		margin: 8px 0 0 26px;
	}
	.acts {
		display: flex;
		gap: 4px;
	}
	.decide {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--teal-wash);
	}
	@media (max-width: 700px) {
		.page {
			padding: 24px 16px 48px;
		}
		.head {
			flex-direction: column;
		}
	}
</style>
