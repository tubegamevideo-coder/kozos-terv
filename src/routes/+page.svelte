<script lang="ts">
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('hu-HU') : '–');
</script>

<svelte:head><title>Közös tervező</title></svelte:head>

<main>
	<header>
		<h1>Közös tervező</h1>
		<form method="POST" action="/logout">
			<span class="muted">{data.user.name} · {data.user.email}</span>
			<button class="link">Kilépés</button>
		</form>
	</header>

	{#if form?.ok}<p class="ok">{form.ok}</p>{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}

	<section>
		<h2>Projektek</h2>
		{#if data.projects.length}
			<table>
				<thead><tr><th>Projekt</th><th>Munkatér</th><th>Szerepkör</th><th>Új változás</th></tr></thead>
				<tbody>
					{#each data.projects as p (p.id)}
						<tr><td><strong>{p.name}</strong><br /><span class="muted">{p.goal}</span></td><td>{p.workspace}</td><td>{p.role}</td><td>{p.unseenChanges}</td></tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted">Még nincs projekted.</p>
		{/if}
		<p class="muted">A dokumentumok webes nézete a következő lépésben jön; addig a Claude-dal dolgozz bennük.</p>
	</section>

	<section>
		<h2>Claude csatlakoztatása</h2>
		<p>
			claude.ai / Claude asztali app: <em>Beállítások → Csatlakozók → Egyedi csatlakozó hozzáadása</em>, URL:
			<code>{data.mcpUrl}</code>
		</p>
		<p>Claude Code: <code>claude mcp add --transport http kozos-terv {data.mcpUrl}</code>, majd <code>/mcp</code> → belépés.</p>

		<h3>Kapcsolódott kliensek</h3>
		{#if data.clients.length}
			<table>
				<thead><tr><th>Kliens</th><th>Kapcsolódott</th><th>Utoljára</th><th></th></tr></thead>
				<tbody>
					{#each data.clients as c (c.clientId)}
						<tr>
							<td>{c.name}</td><td>{fmt(c.connectedAt)}</td><td>{fmt(c.lastUsedAt)}</td>
							<td><form method="POST" action="?/disconnect"><input type="hidden" name="clientId" value={c.clientId} /><button class="link danger">Visszavonás</button></form></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted">Még egy Claude sem kapcsolódott a fiókodhoz.</p>
		{/if}
	</section>

	{#each data.ownedWorkspaces as w (w.id)}
		<section>
			<h2>Tagok meghívása – {w.name}</h2>
			<form method="POST" action="?/invite" class="row">
				<input type="hidden" name="workspaceId" value={w.id} />
				<input type="email" name="email" placeholder="gmail-cím" required />
				<select name="role"><option value="editor">szerkesztő</option><option value="viewer">olvasó</option><option value="owner">tulajdonos</option></select>
				<button class="button">Meghívás</button>
			</form>
			{#if w.pending.length}
				<ul>
					{#each w.pending as i (i.id)}
						<li>
							{i.email} ({i.role}), lejár: {fmt(i.expiresAt)}
							<form method="POST" action="?/revokeInvite" class="inline"><input type="hidden" name="invitationId" value={i.id} /><button class="link danger">visszavonás</button></form>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="muted">A meghívott a Google-fiókjával lép be ezen az oldalon; a Google-projekt „Test users” listájára is fel kell venni, amíg az app tesztmódban van.</p>
		</section>
	{/each}
</main>
