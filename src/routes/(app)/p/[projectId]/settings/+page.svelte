<script lang="ts">
	import { enhance } from '$app/forms';
	import { Copy, FileText, FolderGit2, KeyRound, ShieldCheck } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import { toast, withToast } from '../../../../../lib/toast.svelte';
	import { ago, kindLabel } from '../../../../../lib/ui';
	let { data }: PageProps = $props();
	const base = $derived(`/p/${data.project.id}`);
	const ask = (text: string) => (e: SubmitEvent) => {
		if (!confirm(text)) e.preventDefault();
	};
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast('Kimásolva.');
		} catch {
			toast('Nem sikerült a vágólapra másolni; jelöld ki, és másold kézzel.', 'error');
		}
	}
</script>

<svelte:head><title>Beállítások – {data.project.name}</title></svelte:head>

<div class="page">
	<h1 class="page-title">Beállítások</h1>

	<section class="block">
		<h2 class="section-title">Projekt</h2>
		<form method="POST" action="?/info" class="instr" use:enhance={withToast({ reset: false })}>
			<div>
				<label class="lbl" for="p-name">Név</label>
				<input id="p-name" name="name" value={data.project.name} required disabled={data.role === 'viewer'} />
			</div>
			<div>
				<label class="lbl" for="p-goal">Cél egy mondatban</label>
				<input id="p-goal" name="goal" value={data.project.goal} disabled={data.role === 'viewer'} />
			</div>
			{#if data.role !== 'viewer'}<div class="row"><span class="grow"></span><button class="btn">Mentés</button></div>{/if}
		</form>
	</section>

	<section class="block">
		<h2 class="section-title">Szabályok a Claude-oknak</h2>
		<p class="muted small expl">Minden Claude a munka elején megkapja, és betartja. Írd le, hogyan dolgozzanak ebben a projektben: nyelv, stílus, mit ne csináljanak. Csak ember módosíthatja.</p>
		<form method="POST" action="?/instructions" class="instr" data-editing="true" use:enhance={withToast({ reset: false })}>
			<textarea name="instructions" rows="9" disabled={data.role === 'viewer'} aria-label="Projektutasítás">{data.instructions}</textarea>
			{#if data.role !== 'viewer'}<div class="row"><span class="grow"></span><button class="btn">Mentés</button></div>{/if}
		</form>
	</section>

	<section class="block">
		<h2 class="section-title">Védett dokumentumok</h2>
		<p class="muted small expl">Védett dokumentumba a Claude-ok nem írhatnak közvetlenül, csak javasolhatnak. Ezt a munkatér tulajdonosa állíthatja.</p>
		<div class="panel">
			{#each data.docs as d (d.id)}
				<div class="drow">
					{#if d.isProtected}<ShieldCheck size={17} class="ic on" />{:else}<FileText size={17} class="ic" />{/if}
					<a class="grow" href={`${base}/d/${d.id}`}>{d.title}</a>
					<span class="faint small">{kindLabel(d.kind)}</span>
					{#if data.role === 'owner'}
						<form method="POST" action="?/protect" use:enhance={withToast()}>
							<input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="value" value={d.isProtected ? '0' : '1'} />
							<label class="switch" title={d.isProtected ? 'Védett' : 'Szabad'}>
								<input type="checkbox" checked={d.isProtected} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								<span class="tr"></span>
								<span class="small">{d.isProtected ? 'Védett' : 'Szabad'}</span>
							</label>
						</form>
					{:else}
						<span class="tag" class:teal={d.isProtected}>{d.isProtected ? 'Védett' : 'Szabad'}</span>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<section class="block" id="repok">
		<h2 class="section-title">Repók</h2>
		<p class="muted small expl">
			Ezekből a GitHub- és GitLab-repókból lehet szakaszt hivatkozni (például a rendszertervet a <code>docs/</code> mappából). A hivatkozott szakasz itt csak olvasható, a repó változásai magától átjönnek. Privát repóhoz generálj SSH-kulcsot, és add hozzá a repóhoz Deploy keyként. Repót és kulcsot a munkatér tulajdonosa kezel.
		</p>
		<div class="panel">
			{#each data.repos as r (r.id)}
				<div class="repo">
					<div class="drow">
						<FolderGit2 size={17} class="ic on" />
						<span class="grow">{r.repo} <span class="faint small">{r.provider === 'github' ? 'GitHub' : 'GitLab'} · {r.addedBy} vette fel, {ago(r.createdAt)}</span></span>
						{#if data.role === 'owner'}
							<form method="POST" action="?/removeRepo" use:enhance={withToast()} onsubmit={ask(`Kiveszed a(z) ${r.repo} repót? A már hivatkozott szakaszok megmaradnak, de nem frissülnek tovább, és a repó SSH-kulcsa is törlődik.`)}>
								<input type="hidden" name="repoId" value={r.id} />
								<button class="btn ghost sm">Kivétel</button>
							</form>
						{/if}
					</div>
					<div class="access small">
						<KeyRound size={14} />
						{#if r.sshPublicKey}
							<span class="grow">
								SSH-kulccsal olvas <code title={r.sshFingerprint ?? ''}>{r.sshFingerprint?.slice(7, 19)}…</code>
								{#if r.sshVerifiedAt}<span class="ok">· ellenőrizve {ago(r.sshVerifiedAt)}</span>{:else}<span class="warn">· még nincs ellenőrizve</span>{/if}
							</span>
							{#if data.role === 'owner'}
								<form method="POST" action="?/checkKey" use:enhance={withToast()}>
									<input type="hidden" name="repoId" value={r.id} />
									<button class="btn quiet sm">Ellenőrzés</button>
								</form>
								<form method="POST" action="?/genKey" use:enhance={withToast()} onsubmit={ask('Új kulcsot generálsz? A régi azonnal érvényét veszti; az újat hozzá kell adnod a repóhoz.')}>
									<input type="hidden" name="repoId" value={r.id} />
									<button class="btn ghost sm">Új kulcs</button>
								</form>
								<form method="POST" action="?/removeKey" use:enhance={withToast()} onsubmit={ask('Törlöd az SSH-kulcsot? Utána a repót újra tokennel (ha van), vagy csak nyilvánosan éri el.')}>
									<input type="hidden" name="repoId" value={r.id} />
									<button class="btn ghost sm">Kulcs törlése</button>
								</form>
							{/if}
						{:else}
							<span class="grow muted">
								{(r.provider === 'github' ? data.tokens.github : data.tokens.gitlab)
									? `A szerver ${r.provider === 'github' ? 'GitHub' : 'GitLab'}-tokenjével olvas.`
									: 'Nyilvánosan olvas; privát repóhoz SSH-kulcs kell.'}
							</span>
							{#if data.role === 'owner'}
								<form method="POST" action="?/genKey" use:enhance={withToast()}>
									<input type="hidden" name="repoId" value={r.id} />
									<button class="btn quiet sm">SSH-kulcs generálása</button>
								</form>
							{/if}
						{/if}
					</div>
					{#if r.sshPublicKey}
						<details class="keybox" open={!r.sshVerifiedAt}>
							<summary class="small">Nyilvános kulcs és teendők</summary>
							<div class="keyline">
								<code class="pub">{r.sshPublicKey}</code>
								<button type="button" class="btn ghost sm" onclick={() => copy(r.sshPublicKey ?? '')}><Copy size={13} /> Másolás</button>
							</div>
							<ol class="small steps">
								<li>
									Nyisd meg a repó <a href={r.deployKeyUrl} target="_blank" rel="noopener noreferrer">Deploy keys beállítását</a>
									({r.provider === 'github' ? 'Settings → Deploy keys → Add deploy key' : 'Settings → Repository → Deploy keys'}).
								</li>
								<li>
									Cím: <code>Teréz</code>, kulcs: a fenti sor. Az írási jogot ({r.provider === 'github' ? '„Allow write access”' : '„Grant write permissions to this key”'}) hagyd kikapcsolva.
								</li>
								<li>Mentés után kattints itt az <b>Ellenőrzés</b> gombra.</li>
							</ol>
						</details>
					{/if}
				</div>
			{:else}
				<p class="drow muted small">Még nincs hivatkozható repó.</p>
			{/each}
			{#if data.role === 'owner'}
				<form method="POST" action="?/addRepo" class="drow addrepo" use:enhance={withToast()}>
					<select name="provider" aria-label="Szolgáltató">
						<option value="github">GitHub</option>
						<option value="gitlab">GitLab</option>
					</select>
					<input name="repo" required placeholder="tulajdonos/név, vagy a repó címe" aria-label="Repó" />
					<button class="btn">Felvétel</button>
				</form>
			{/if}
		</div>
	</section>

	<section class="block">
		<h2 class="section-title">Lomtár</h2>
		{#if data.trashed.length}
			<div class="panel">
				{#each data.trashed as t (t.id)}
					<div class="drow">
						<span class="grow">{t.title} <span class="faint small">a(z) {t.documentTitle} dokumentumból, {ago(t.deletedAt)}</span></span>
						<a class="btn quiet sm" href={`${base}/s/${t.id}/history`}>Visszaállítás</a>
					</div>
				{/each}
			</div>
		{:else}
			<p class="muted small">A lomtár üres. Törölt szakasz ide kerül, és innen visszaállítható.</p>
		{/if}
	</section>
</div>

<style>
	.page {
		max-width: 820px;
		padding: 36px 40px 64px;
	}
	.block {
		margin-top: 32px;
	}
	.expl {
		margin: -4px 0 12px;
		max-width: 68ch;
	}
	.instr {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.instr textarea {
		font-family: var(--serif);
		font-size: 15.5px;
		line-height: 1.6;
	}
	.drow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 14px;
		border-top: 1px solid var(--rule);
	}
	.drow:first-child {
		border-top: 0;
	}
	.drow :global(.ic) {
		color: var(--faint);
		flex: none;
	}
	.drow :global(.ic.on) {
		color: var(--teal);
	}
	p.drow {
		margin: 0;
	}
	.addrepo select {
		width: auto;
	}
	.addrepo input {
		flex: 1;
	}
	/* Repó: név, hozzáférés (token / SSH-kulcs), nyilvános kulcs */
	.repo {
		border-top: 1px solid var(--rule);
	}
	.repo:first-child {
		border-top: 0;
	}
	.repo .drow {
		border-top: 0;
		padding-bottom: 4px;
	}
	.access {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 10px;
		padding: 0 14px 10px 43px;
		color: var(--graphite);
	}
	.access > :global(svg) {
		flex: none;
		color: var(--faint);
	}
	.access .ok {
		color: var(--teal);
	}
	.access .warn {
		color: var(--mark-ink);
	}
	.keybox {
		margin: 0 14px 12px 43px;
		padding: 8px 12px;
		border-radius: var(--r-sm);
		background: var(--sunken);
	}
	.keybox summary {
		cursor: pointer;
		color: var(--graphite);
	}
	.keyline {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 8px;
	}
	.pub {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 12px;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.steps {
		margin: 8px 0 2px;
		padding-left: 20px;
		color: var(--graphite);
	}
	.steps li + li {
		margin-top: 2px;
	}
	@media (max-width: 760px) {
		.access,
		.keybox {
			padding-left: 14px;
			margin-left: 0;
		}
		.keybox {
			margin: 0 0 12px;
		}
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		min-width: 92px;
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.tr {
		position: relative;
		width: 32px;
		height: 18px;
		border-radius: 9px;
		background: var(--rule-strong);
		transition: background 0.15s;
	}
	.tr::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}
	.switch input:checked + .tr {
		background: var(--teal);
	}
	.switch input:checked + .tr::after {
		transform: translateX(14px);
	}
	.switch input:focus-visible + .tr {
		box-shadow: var(--focus);
	}
	@media (max-width: 700px) {
		.page {
			padding: 24px 16px 48px;
		}
	}
</style>
