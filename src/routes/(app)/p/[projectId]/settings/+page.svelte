<script lang="ts">
	import { enhance } from '$app/forms';
	import { FileText, ShieldCheck } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import { withToast } from '../../../../../lib/toast.svelte';
	import { ago, kindLabel } from '../../../../../lib/ui';
	let { data }: PageProps = $props();
	const base = $derived(`/p/${data.project.id}`);
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
