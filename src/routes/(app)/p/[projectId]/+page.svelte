<script lang="ts">
	import { enhance } from '$app/forms';
	import { CircleHelp, FileText, GitPullRequestArrow, Lock, Plus, ShieldCheck } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import Author from '../../../../lib/components/Author.svelte';
	import Avatar from '../../../../lib/components/Avatar.svelte';
	import Empty from '../../../../lib/components/Empty.svelte';
	import { withToast } from '../../../../lib/toast.svelte';
	import { ago, dayLabel, kindLabel, timeOnly } from '../../../../lib/ui';
	let { data }: PageProps = $props();
	const b = $derived(data.brief);
	const base = $derived(`/p/${b.project.id}`);
	const needsYou = $derived(b.openProposals.length + b.openQuestions.filter((q) => q.status === 'disputed').length);
	const feed = $derived.by(() => {
		const groups: { day: string; items: typeof b.changesSinceLastVisit.items }[] = [];
		for (const e of [...b.changesSinceLastVisit.items].reverse()) {
			const day = dayLabel(e.at);
			const g = groups.at(-1);
			if (g && g.day === day) g.items.push(e);
			else groups.push({ day, items: [e] });
		}
		return groups;
	});
	let newDoc = $state(false);
	const minutesLeft = (iso: string) => Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
</script>

<svelte:head><title>{b.project.name} – Közös tervező</title></svelte:head>

<div class="page">
	<header class="head">
		<div class="grow">
			<h1 class="page-title">{b.project.name}</h1>
			{#if b.project.goal}<p class="muted goal">{b.project.goal}</p>{/if}
		</div>
		{#if data.role !== 'viewer'}
			<button class="btn quiet" onclick={() => (newDoc = !newDoc)}><Plus size={16} /> Új dokumentum</button>
		{/if}
	</header>

	{#if newDoc}
		<form method="POST" action="?/createDocument" class="newdoc panel" use:enhance={withToast({ onDone: () => (newDoc = false) })}>
			<input name="title" placeholder="A dokumentum címe" required aria-label="Cím" />
			<select name="kind" aria-label="Típus">
				<option value="note">Jegyzet – bárki szabadon írhat bele</option>
				<option value="research">Kutatás – szabadon írható</option>
				<option value="main_plan">Fő terv – védett, a Claude csak javasolhat</option>
			</select>
			<button class="btn">Létrehozás</button>
		</form>
	{/if}

	{#if needsYou}
		<section class="attention">
			<h2 class="section-title">Rád vár</h2>
			<div class="att-list">
				{#each b.openProposals as p (p.id)}
					<a class="att" href={`${base}/proposals#p-${p.id}`}>
						<GitPullRequestArrow size={16} />
						<span class="grow">
							<strong>{p.newSection ? `Új szakasz: ${p.title}` : p.sectionTitle}</strong>
							<span class="muted"> – {p.reason}</span>
							<span class="meta small"><Author name={p.by} via={p.via} size={18} short /> <span class="faint">{ago(p.createdAt)}</span></span>
						</span>
					</a>
				{/each}
				{#each b.openQuestions.filter((q) => q.status === 'disputed') as q (q.id)}
					<a class="att" href={`${base}/questions#q-${q.id}`}>
						<CircleHelp size={16} />
						<span class="grow"><strong>{q.title}</strong> <span class="muted">– vitatott kérdés, döntés kell</span></span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if b.activeLocks.length}
		<section class="block">
			<h2 class="section-title">Most dolgoznak</h2>
			<div class="panel">
				{#each b.activeLocks as l (l.sectionId)}
					<div class="lock-row">
						<Avatar name={l.heldBy} claude={l.via === 'claude'} size={26} />
						<span class="grow">
							<strong>{l.heldBy}{l.via === 'claude' ? ' Claude-ja' : ''}</strong>
							<span class="muted"> a(z) „{l.sectionTitle}” szakaszon{l.purpose ? `: ${l.purpose}` : ''}</span>
						</span>
						<span class="tag"><Lock size={12} /> még {minutesLeft(l.expiresAt)} percig</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<div class="cols">
		<section class="block">
			<h2 class="section-title">Dokumentumok</h2>
			{#if b.documents.length}
				<div class="panel">
					{#each b.documents as d (d.id)}
						<a class="drow" href={`${base}/d/${d.id}`}>
							{#if d.isProtected}<ShieldCheck size={18} />{:else}<FileText size={18} />{/if}
							<span class="grow">
								<span class="dt">{d.title}</span>
								<span class="faint small">{d.sections.length} szakasz</span>
							</span>
							{#if d.sections.some((s) => s.lock)}<span class="tag"><Lock size={12} /> szerkesztik</span>{/if}
							<span class="tag" class:teal={d.isProtected}>{kindLabel(d.kind)}</span>
						</a>
					{/each}
				</div>
			{:else}
				<Empty title="Még nincs dokumentum">
					<p>Kezdd egy fő tervvel, vagy kérd meg a Claude-odat egy új beszélgetésben: „a közös tervezőben a {b.project.name} projekthez írj egy első vázlatot”.</p>
				</Empty>
			{/if}
		</section>

		<section class="block">
			<h2 class="section-title">Mi történt, mióta itt voltál</h2>
			{#if feed.length}
				<div class="feed">
					{#each feed as g (g.day)}
						<p class="day faint small">{g.day}</p>
						{#each g.items as e (e.id)}
							<div class="ev">
								<Avatar name={e.by} claude={e.via === 'claude'} size={22} />
								<p class="grow"><strong>{e.by}{e.via === 'claude' ? ' Claude-ja' : ''}</strong> <span class="muted">{e.summary}</span></p>
								<span class="faint tiny">{timeOnly(e.at)}</span>
							</div>
						{/each}
					{/each}
					{#if b.changesSinceLastVisit.hasMore}<p class="faint tiny">A régebbi változások a dokumentumok előzményében vannak.</p>{/if}
				</div>
			{:else}
				<p class="muted small calm">Nincs újdonság a többiektől{b.changesSinceLastVisit.lastVisitedAt ? `, ${ago(b.changesSinceLastVisit.lastVisitedAt)} jártál itt utoljára` : ''}.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		max-width: 1120px;
		padding: 36px 40px 64px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 24px;
	}
	.goal {
		margin: 6px 0 0;
		max-width: 68ch;
	}
	.newdoc {
		display: grid;
		grid-template-columns: 1fr 300px auto;
		gap: 8px;
		padding: 12px;
		margin-bottom: 24px;
	}
	.attention {
		margin-bottom: 32px;
	}
	.att-list {
		display: flex;
		flex-direction: column;
		border-radius: var(--r-md);
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--mark) 55%, transparent);
		background: var(--mark-wash);
	}
	.att {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 14px;
		color: var(--ink);
		border-top: 1px solid color-mix(in srgb, var(--mark) 30%, transparent);
	}
	.att:first-child {
		border-top: 0;
	}
	.att:hover {
		background: color-mix(in srgb, var(--mark) 22%, var(--mark-wash));
		text-decoration: none;
	}
	.att > :global(svg) {
		color: var(--mark-ink);
		flex: none;
		align-self: flex-start;
		margin-top: 3px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
	}
	.block {
		margin-bottom: 32px;
	}
	.lock-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-top: 1px solid var(--rule);
	}
	.lock-row:first-child {
		border-top: 0;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 40px;
	}
	.drow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		color: var(--ink);
		border-top: 1px solid var(--rule);
	}
	.drow:first-child {
		border-top: 0;
	}
	.drow:hover {
		background: var(--sunken);
		text-decoration: none;
	}
	.drow > :global(svg) {
		color: var(--faint);
		flex: none;
	}
	.dt {
		display: block;
		font-weight: 500;
	}
	.feed {
		display: flex;
		flex-direction: column;
	}
	.day {
		margin: 14px 0 6px;
		font-weight: 600;
	}
	.day:first-child {
		margin-top: 0;
	}
	.ev {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 6px 0;
	}
	.ev p {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.45;
	}
	.calm {
		margin: 0;
	}
	@media (max-width: 1000px) {
		.cols {
			grid-template-columns: 1fr;
			gap: 0;
		}
	}
	@media (max-width: 700px) {
		.page {
			padding: 24px 16px 48px;
		}
		.newdoc {
			grid-template-columns: 1fr;
		}
		.head {
			flex-direction: column;
		}
		.lock-row {
			flex-wrap: wrap;
		}
	}
</style>
