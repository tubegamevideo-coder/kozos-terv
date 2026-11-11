<script lang="ts">
	import { enhance } from '$app/forms';
	import { ArrowUpRight, Folder, Plus, Unplug } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import CopyField from '../../lib/components/CopyField.svelte';
	import Empty from '../../lib/components/Empty.svelte';
	import { withToast } from '../../lib/toast.svelte';
	import { ago, fmtDate, roleLabel } from '../../lib/ui';
	let { data }: PageProps = $props();
	let creating = $state(false);
	const firstName = $derived(data.user.name.split(' ').at(-1));
</script>

<svelte:head><title>Projektek – Közös tervező</title></svelte:head>

<div class="page">
	<header class="head">
		<div class="grow">
			<h1 class="page-title">Projektek</h1>
			<p class="muted lead">Szia, {firstName}! Itt látod, hol történt valami, mióta utoljára benéztél.</p>
		</div>
		{#if data.workspaces.length}
			<button class="btn" onclick={() => (creating = !creating)}><Plus size={16} /> Új projekt</button>
		{/if}
	</header>

	{#if creating}
		<form method="POST" action="?/createProject" class="panel newp" use:enhance={withToast()}>
			<div>
				<label class="lbl" for="np-name">Név</label>
				<input id="np-name" name="name" placeholder="pl. Cégkereső platform" required />
			</div>
			<div>
				<label class="lbl" for="np-goal">Cél egy mondatban</label>
				<input id="np-goal" name="goal" placeholder="Mit akartok elérni? A Claude-ok is ezt látják elsőként." />
			</div>
			{#if data.workspaces.length > 1}
				<div>
					<label class="lbl" for="np-ws">Munkatér</label>
					<select id="np-ws" name="workspaceId">{#each data.workspaces as w (w.id)}<option value={w.id}>{w.name}</option>{/each}</select>
				</div>
			{:else}
				<input type="hidden" name="workspaceId" value={data.workspaces[0].id} />
			{/if}
			<p class="faint tiny">A projektet a munkatér minden tagja látja. Dokumentumokat utána a projekt oldalán, vagy a Claude-oddal hozhatsz létre.</p>
			<div class="row"><span class="grow"></span><button type="button" class="btn ghost" onclick={() => (creating = false)}>Mégse</button><button class="btn">Projekt létrehozása</button></div>
		</form>
	{/if}

	<div class="plist">
		{#each data.projects as p (p.id)}
			<a class="prow" href={`/p/${p.id}`}>
				<Folder size={18} />
				<div class="grow">
					<p class="pn">{p.name}</p>
					{#if p.goal}<p class="muted small pg">{p.goal}</p>{/if}
				</div>
				<span class="tag">{p.workspace}</span>
				<span class="faint small role">{roleLabel(p.role)}</span>
				{#if p.unseenChanges}<span class="tag teal">{p.unseenChanges} új változás</span>{/if}
			</a>
		{:else}
			<Empty title="Még nincs projekted">A munkatér tulajdonosa tud projektet létrehozni, vagy kérd meg a Claude-odat: „hozz létre egy projektet…”.</Empty>
		{/each}
	</div>

	<section id="claude" class="block">
		<h2 class="section-title">Claude csatlakoztatása</h2>
		{#if !data.clients.length}
			<p class="muted small">A Claude-od a saját fiókoddal fér hozzá a projektekhez; amit ír, a te neved alatt, Claude-jelöléssel jelenik meg.</p>
		{/if}
		<div class="connect panel">
			<ol class="steps">
				<li><strong>claude.ai</strong> vagy a Claude asztali app: <em>Beállítások → Csatlakozók → Egyedi csatlakozó hozzáadása</em></li>
				<li>Ezt a címet add meg (a név lehet „Közös tervező”):<CopyField value={data.mcpUrl} label="MCP-cím" /></li>
				<li>Kattints a <em>Csatlakozás</em> gombra, lépj be a Google-fiókoddal, majd engedélyezd.</li>
			</ol>
			<details class="cc">
				<summary class="small">Claude Code-ból</summary>
				<CopyField value={`claude mcp add --transport http kozos-terv ${data.mcpUrl}`} />
				<p class="faint tiny">Utána Claude Code-ban: <code>/mcp</code> → kozos-terv → Authenticate.</p>
			</details>
		</div>

		{#if data.clients.length}
			<h3 class="sub">Kapcsolódott Claude-ok</h3>
			<div class="panel list">
				{#each data.clients as c (c.clientId)}
					<div class="lrow">
						<span class="grow"><strong>{c.name}</strong> <span class="faint small">kapcsolódott: {fmtDate(c.connectedAt)}, utoljára: {ago(c.lastUsedAt)}</span></span>
						<form method="POST" action="?/disconnect" use:enhance={withToast()}>
							<input type="hidden" name="clientId" value={c.clientId} />
							<button class="btn danger sm"><Unplug size={14} /> Kapcsolat bontása</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#each data.ownedWorkspaces as w (w.id)}
		<section class="block">
			<h2 class="section-title">Tagok meghívása: {w.name}</h2>
			<form method="POST" action="?/invite" class="invite" use:enhance={withToast()}>
				<input type="hidden" name="workspaceId" value={w.id} />
				<input type="email" name="email" placeholder="valaki@gmail.com" required aria-label="E-mail-cím" />
				<select name="role" aria-label="Szerepkör">
					<option value="editor">szerkesztő</option>
					<option value="viewer">olvasó</option>
					<option value="owner">tulajdonos</option>
				</select>
				<button class="btn">Meghívás</button>
			</form>
			<p class="faint tiny">A meghívott a Google-fiókjával lép be ezen az oldalon, és az első belépéskor taggá válik. Amíg a Google-app tesztmódban van, a címét a Google Cloud „Test users” listájára is vedd fel.</p>
			{#if w.pending.length}
				<div class="panel list">
					{#each w.pending as i (i.id)}
						<div class="lrow">
							<span class="grow">{i.email} <span class="faint small">{roleLabel(i.role)}, lejár: {fmtDate(i.expiresAt)}</span></span>
							<form method="POST" action="?/revokeInvite" use:enhance={withToast()}>
								<input type="hidden" name="invitationId" value={i.id} />
								<button class="btn ghost sm">Visszavonás</button>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/each}

	<p class="faint tiny about">
		Hogyan működik: mindenki a saját Claude-jával tervez, a szerver pedig szakaszonként zárolja és verziózza a munkát, így senki nem írja felül a másikét. <a href="https://github.com/tubegamevideo-coder/kozos-terv" target="_blank" rel="noreferrer">Forráskód <ArrowUpRight size={12} /></a>
	</p>
</div>

<style>
	.page {
		max-width: 860px;
		padding: 36px 40px 64px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}
	.lead {
		margin: 6px 0 22px;
	}
	.newp {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		margin-bottom: 20px;
	}
	.plist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--rule);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}
	.plist:empty {
		display: none;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		color: var(--ink);
		border-top: 1px solid var(--rule);
	}
	.prow:first-child {
		border-top: 0;
	}
	.prow:hover {
		background: var(--sunken);
		text-decoration: none;
	}
	.prow :global(svg) {
		color: var(--faint);
		flex: none;
	}
	.pn {
		margin: 0;
		font-weight: 600;
	}
	.pg {
		margin: 2px 0 0;
	}
	.role {
		width: 76px;
		text-align: right;
	}
	.block {
		margin-top: 40px;
	}
	.sub {
		font-size: 14px;
		margin: 20px 0 8px;
	}
	.connect {
		padding: 16px 18px;
	}
	.steps {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.steps li :global(.copy) {
		margin-top: 6px;
	}
	.cc {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--rule);
	}
	.cc summary {
		cursor: pointer;
		color: var(--graphite);
		margin-bottom: 8px;
	}
	.list .lrow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-top: 1px solid var(--rule);
	}
	.list .lrow:first-child {
		border-top: 0;
	}
	.invite {
		display: grid;
		grid-template-columns: 1fr 150px auto;
		gap: 8px;
		margin-bottom: 8px;
	}
	.about {
		margin-top: 48px;
	}
	@media (max-width: 700px) {
		.page {
			padding: 24px 16px 48px;
		}
		.invite {
			grid-template-columns: 1fr;
		}
		.role {
			display: none;
		}
	}
</style>
