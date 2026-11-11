<script lang="ts">
	import { enhance } from '$app/forms';
	import { ChevronDown, ChevronUp, Plus } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Author from '../../../../../lib/components/Author.svelte';
	import Empty from '../../../../../lib/components/Empty.svelte';
	import { withToast } from '../../../../../lib/toast.svelte';
	import { ideaStatusLabel } from '../../../../../lib/ui';
	let { data }: PageProps = $props();
	const canEdit = $derived(data.role !== 'viewer');
	const statuses = ['new', 'investigating', 'adopted', 'rejected'] as const;
	let filter = $state<'all' | (typeof statuses)[number]>('all');
	const shown = $derived(filter === 'all' ? data.ideas.filter((i) => i.status !== 'rejected') : data.ideas.filter((i) => i.status === filter));
	const count = (s: string) => data.ideas.filter((i) => i.status === s).length;
	let adding = $state(false);
</script>

<svelte:head><title>Ötletek – {data.project.name}</title></svelte:head>

<div class="page">
	<header class="head">
		<div class="grow">
			<h1 class="page-title">Ötletek</h1>
			<p class="muted lead">Gyors ötletek, mielőtt bekerülnének a tervbe. Szavazz rájuk; amelyik bekerül, azt „Beemelve” állapotba teheted.</p>
		</div>
		{#if canEdit}<button class="btn quiet" onclick={() => (adding = !adding)}><Plus size={16} /> Új ötlet</button>{/if}
	</header>

	{#if adding}
		<form method="POST" action="?/add" class="panel newi" use:enhance={withToast({ onDone: () => (adding = false) })}>
			<input name="title" placeholder="Az ötlet egy mondatban" required aria-label="Ötlet" />
			<textarea name="body" rows="3" placeholder="Kifejtés (nem kötelező)" aria-label="Kifejtés"></textarea>
			<input name="tags" placeholder="Címkék vesszővel, pl. értesítés, felület" aria-label="Címkék" />
			<div class="row"><span class="grow"></span><button type="button" class="btn ghost" onclick={() => (adding = false)}>Mégse</button><button class="btn">Felvétel</button></div>
		</form>
	{/if}

	<div class="filters" role="tablist" aria-label="Szűrés állapot szerint">
		<button role="tab" aria-selected={filter === 'all'} class:on={filter === 'all'} onclick={() => (filter = 'all')}>Aktív</button>
		{#each statuses as st (st)}
			<button role="tab" aria-selected={filter === st} class:on={filter === st} onclick={() => (filter = st)}>{ideaStatusLabel(st)} <span class="faint">{count(st)}</span></button>
		{/each}
		{#if data.tag}<a class="tag teal" href="?">#{data.tag} ✕</a>{/if}
	</div>

	{#if shown.length}
		<div class="ideas">
			{#each shown as i (i.id)}
				<article class="idea" class:adopted={i.status === 'adopted'}>
					<div class="vote">
						{#if canEdit}
							<form method="POST" action="?/vote" use:enhance={withToast()}>
								<input type="hidden" name="ideaId" value={i.id} /><input type="hidden" name="value" value={i.myVote === 1 ? 0 : 1} />
								<button class="vb" class:on={i.myVote === 1} aria-label="Támogatom"><ChevronUp size={18} /></button>
							</form>
						{/if}
						<span class="vn" class:pos={i.votes > 0} class:neg={i.votes < 0}>{i.votes}</span>
						{#if canEdit}
							<form method="POST" action="?/vote" use:enhance={withToast()}>
								<input type="hidden" name="ideaId" value={i.id} /><input type="hidden" name="value" value={i.myVote === -1 ? 0 : -1} />
								<button class="vb" class:on={i.myVote === -1} aria-label="Ellenzem"><ChevronDown size={18} /></button>
							</form>
						{/if}
					</div>
					<div class="ib">
						<h2>{i.title}</h2>
						{#if i.body}<p class="ibody">{i.body}</p>{/if}
						<div class="meta">
							<Author name={i.by} via={i.via} size={18} short />
							{#each i.tags as t (t)}<a class="tag" href={`?cimke=${encodeURIComponent(t)}`}>#{t}</a>{/each}
						</div>
						<div class="foot">
							{#if canEdit}
								<form method="POST" action="?/status" use:enhance={withToast()}>
									<input type="hidden" name="ideaId" value={i.id} />
									<select name="status" class="st" aria-label="Állapot" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										{#each statuses as st (st)}<option value={st} selected={i.status === st}>{ideaStatusLabel(st)}</option>{/each}
									</select>
								</form>
							{:else}
								<span class="tag">{ideaStatusLabel(i.status)}</span>
							{/if}
						</div>
					</div>
				</article>
			{/each}
		</div>
	{:else}
		<Empty title={data.ideas.length ? 'Ebben a szűrésben nincs ötlet' : 'Még nincs ötlet'}>
			{#if !data.ideas.length}Kérd meg a Claude-odat: „ötleteljünk a közös tervezőben a … témáról”, vagy vegyél fel egyet fent.{/if}
		</Empty>
	{/if}
</div>

<style>
	.page {
		max-width: 1080px;
		padding: 36px 40px 64px;
	}
	.head {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 18px;
	}
	.lead {
		margin: 6px 0 0;
		max-width: 70ch;
	}
	.newi {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
		margin-bottom: 20px;
	}
	.filters {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.filters button {
		height: 30px;
		padding: 0 12px;
		border-radius: 15px;
		border: 1px solid var(--rule-strong);
		background: var(--surface);
		color: var(--graphite);
		cursor: pointer;
		font-size: 13px;
	}
	.filters button.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}
	.filters button.on .faint {
		color: inherit;
		opacity: 0.6;
	}
	.ideas {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 12px;
		align-items: start;
	}
	.idea {
		display: flex;
		gap: 10px;
		padding: 14px 14px 12px 8px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--r-md);
	}
	.idea.adopted {
		border-color: color-mix(in srgb, var(--teal) 50%, transparent);
	}
	.vote {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 32px;
		flex: none;
	}
	.vb {
		display: grid;
		place-items: center;
		width: 28px;
		height: 24px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--faint);
		cursor: pointer;
	}
	.vb:hover {
		background: var(--sunken);
		color: var(--ink);
	}
	.vb.on {
		color: var(--teal);
	}
	.vn {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--graphite);
	}
	.vn.pos {
		color: var(--teal);
	}
	.vn.neg {
		color: var(--danger);
	}
	.ib {
		flex: 1;
		min-width: 0;
	}
	.ib h2 {
		font-size: 15px;
		font-weight: 600;
	}
	.ibody {
		margin: 6px 0 0;
		white-space: pre-wrap;
		color: var(--graphite);
		font-size: 13.5px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 12px;
		font-size: 13px;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--rule);
	}
	.st {
		width: auto;
		border-color: transparent;
		background: var(--sunken);
		height: 28px;
		padding: 2px 6px;
		font-size: 12.5px;
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
