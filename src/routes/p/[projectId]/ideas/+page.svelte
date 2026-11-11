<script lang="ts">
	import type { PageProps } from './$types';
	import { ideaStatusLabel, viaLabel } from '../../../../lib/ui';
	let { data, form }: PageProps = $props();
	const canEdit = $derived(data.role !== 'viewer');
	const statuses = ['new', 'investigating', 'adopted', 'rejected'];
</script>

<svelte:head><title>Ötletek – {data.project.name}</title></svelte:head>

{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

{#if canEdit}
	<details>
		<summary>+ Új ötlet</summary>
		<form method="POST" action="?/add" class="col">
			<input name="title" placeholder="Az ötlet röviden" required />
			<textarea name="body" rows="3" placeholder="Kifejtés (nem kötelező)"></textarea>
			<input name="tags" placeholder="címkék vesszővel, pl. értesítés, UI" />
			<button class="button">Felvétel</button>
		</form>
	</details>
{/if}
{#if data.tag}<p>Címke: <span class="badge">{data.tag}</span> <a href="?">összes</a></p>{/if}

<div class="cards">
	{#each data.ideas as i (i.id)}
		<div class="card-i" class:dim={i.status === 'rejected'}>
			<div class="votes">
				{#if canEdit}
					<form method="POST" action="?/vote"><input type="hidden" name="ideaId" value={i.id} /><input type="hidden" name="value" value={i.myVote === 1 ? 0 : 1} /><button class="vote" class:on={i.myVote === 1} title="Támogatom">▲</button></form>
				{/if}
				<strong>{i.votes}</strong>
				{#if canEdit}
					<form method="POST" action="?/vote"><input type="hidden" name="ideaId" value={i.id} /><input type="hidden" name="value" value={i.myVote === -1 ? 0 : -1} /><button class="vote" class:on={i.myVote === -1} title="Ellenzem">▼</button></form>
				{/if}
			</div>
			<div class="body">
				<p><strong>{i.title}</strong></p>
				{#if i.body}<p class="pre small">{i.body}</p>{/if}
				<p class="small muted">{i.by} ({viaLabel(i.via)}) · {#each i.tags as t (t)}<a class="badge" href={`?cimke=${encodeURIComponent(t)}`}>{t}</a> {/each}</p>
				{#if canEdit}
					<form method="POST" action="?/status" class="inline">
						<input type="hidden" name="ideaId" value={i.id} />
						<select name="status" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
							{#each statuses as st (st)}<option value={st} selected={i.status === st}>{ideaStatusLabel(st)}</option>{/each}
						</select>
					</form>
				{:else}
					<span class="badge">{ideaStatusLabel(i.status)}</span>
				{/if}
			</div>
		</div>
	{:else}
		<p class="muted">Még nincs ötlet. Kérd meg a Claude-ot: „ötleteljünk a közös tervezőben erről: …”</p>
	{/each}
</div>

<style>
	.col { display: flex; flex-direction: column; gap: 8px; max-width: 640px; margin: 8px 0; }
	.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
	.card-i { display: flex; gap: 10px; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: var(--card); }
	.card-i.dim { opacity: 0.55; }
	.votes { display: flex; flex-direction: column; align-items: center; gap: 2px; }
	.vote { background: none; border: 0; cursor: pointer; color: var(--muted); font-size: 14px; }
	.vote.on { color: var(--accent); }
	.body p { margin: 2px 0; }
	.pre { white-space: pre-wrap; }
</style>
