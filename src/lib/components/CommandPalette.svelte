<script lang="ts">
	import { goto } from '$app/navigation';
	import { FileText, Folder, Lightbulb, CircleHelp, Search } from '@lucide/svelte';
	import { tick } from 'svelte';

	interface Item {
		kind: 'project' | 'doc' | 'section' | 'question' | 'idea';
		title: string;
		hint?: string;
		href: string;
	}
	let {
		open = $bindable(false),
		projects,
		project
	}: {
		open?: boolean;
		projects: { id: string; name: string }[];
		project: { id: string; name: string; docs: { id: string; title: string }[] } | null;
	} = $props();

	let q = $state('');
	let results = $state<Item[]>([]);
	let active = $state(0);
	let input = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const staticItems = $derived<Item[]>([
		...(project?.docs.map((d) => ({ kind: 'doc' as const, title: d.title, hint: project!.name, href: `/p/${project!.id}/d/${d.id}` })) ?? []),
		...projects.filter((p) => p.id !== project?.id).map((p) => ({ kind: 'project' as const, title: p.name, hint: 'projekt', href: `/p/${p.id}` }))
	]);
	const items = $derived(
		q.trim()
			? [...staticItems.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase())), ...results]
			: staticItems
	);

	$effect(() => {
		if (open) {
			q = '';
			results = [];
			active = 0;
			tick().then(() => input?.focus());
		}
	});

	function search() {
		clearTimeout(timer);
		active = 0;
		const term = q.trim();
		if (!project || term.length < 2) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			const r = await fetch(`/p/${project.id}/search?q=${encodeURIComponent(term)}`);
			if (!r.ok || term !== q.trim()) return;
			const data = (await r.json()) as {
				sections: { sectionId: string; title: string; documentId: string; documentTitle: string; snippet: string }[];
				questions: { id: string; title: string }[];
				ideas: { id: string; title: string }[];
			};
			const base = `/p/${project.id}`;
			results = [
				...data.sections.map((s) => ({ kind: 'section' as const, title: s.title, hint: s.documentTitle, href: `${base}/d/${s.documentId}#s-${s.sectionId}` })),
				...data.questions.map((x) => ({ kind: 'question' as const, title: x.title, hint: 'kérdés', href: `${base}/questions#q-${x.id}` })),
				...data.ideas.map((x) => ({ kind: 'idea' as const, title: x.title, hint: 'ötlet', href: `${base}/ideas` }))
			];
		}, 160);
	}

	function choose(i: Item | undefined) {
		if (!i) return;
		open = false;
		goto(i.href);
	}

	function onkey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			active = Math.min(active + 1, items.length - 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = Math.max(active - 1, 0);
			e.preventDefault();
		} else if (e.key === 'Enter') {
			choose(items[active]);
			e.preventDefault();
		} else if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={() => (open = false)}>
		<div class="palette" role="dialog" tabindex="-1" aria-modal="true" aria-label="Keresés" onclick={(e) => e.stopPropagation()}>
			<div class="bar">
				<Search size={16} />
				<input
					bind:this={input}
					bind:value={q}
					oninput={search}
					onkeydown={onkey}
					placeholder={project ? `Keresés itt: ${project.name}…` : 'Ugrás projektre…'}
					aria-label="Keresés"
				/>
				<kbd>Esc</kbd>
			</div>
			<ul>
				{#each items as it, i (it.href + i)}
					<li>
						<button class:active={i === active} onmouseenter={() => (active = i)} onclick={() => choose(it)}>
							{#if it.kind === 'project'}<Folder size={15} />{:else if it.kind === 'question'}<CircleHelp size={15} />{:else if it.kind === 'idea'}<Lightbulb size={15} />{:else}<FileText size={15} />{/if}
							<span class="grow">{it.title}</span>
							{#if it.hint}<span class="faint small">{it.hint}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="none">{q.trim().length < 2 ? 'Kezdj el gépelni a kereséshez.' : 'Nincs találat.'}</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgb(18 22 29 / 0.35);
		display: grid;
		justify-items: center;
		align-items: start;
		padding-top: 12vh;
	}
	.palette {
		width: min(600px, calc(100vw - 32px));
		background: var(--surface);
		border-radius: 12px;
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		border-bottom: 1px solid var(--rule);
		color: var(--graphite);
	}
	.bar input {
		border: 0;
		box-shadow: none;
		padding: 14px 0;
		font-size: 16px;
		background: transparent;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 6px;
		max-height: 50vh;
		overflow-y: auto;
	}
	li button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: var(--r-sm);
		background: none;
		text-align: left;
		cursor: pointer;
		color: var(--ink);
	}
	li button :global(svg) {
		color: var(--faint);
		flex: none;
	}
	li button.active {
		background: var(--sunken);
	}
	.none {
		padding: 14px 10px;
		color: var(--graphite);
		font-size: 13.5px;
	}
</style>
