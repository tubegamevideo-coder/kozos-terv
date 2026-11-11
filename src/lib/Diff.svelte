<script lang="ts">
	let { lines, collapse = true }: { lines: { type: 'add' | 'del' | 'ctx'; text: string }[]; collapse?: boolean } = $props();

	/** A hosszú változatlan részeket összecsukjuk, csak a változások körüli 2-2 sor marad. */
	const rows = $derived.by(() => {
		if (!collapse) return lines.map((l) => ({ ...l, gap: 0 }));
		const keep = lines.map((l, i) => l.type !== 'ctx' || lines.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== 'ctx'));
		const out: { type: string; text: string; gap: number }[] = [];
		let skipped = 0;
		lines.forEach((l, i) => {
			if (keep[i]) {
				if (skipped) out.push({ type: 'gap', text: '', gap: skipped });
				skipped = 0;
				out.push({ ...l, gap: 0 });
			} else skipped++;
		});
		if (skipped) out.push({ type: 'gap', text: '', gap: skipped });
		return out;
	});
</script>

<div class="diff" role="table" aria-label="Különbség">
	{#each rows as l, i (i)}
		{#if l.type === 'gap'}
			<div class="gap">{l.gap} változatlan sor</div>
		{:else}
			<div class="ln {l.type}"><span class="sign" aria-label={l.type === 'add' ? 'új' : l.type === 'del' ? 'törölt' : ''}>{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</span><span class="tx">{l.text || ' '}</span></div>
		{/if}
	{/each}
</div>

<style>
	.diff {
		font: 13px/1.6 var(--mono);
		border: 1px solid var(--rule);
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--surface);
		max-height: 70vh;
		overflow-y: auto;
	}
	.ln {
		display: grid;
		grid-template-columns: 26px 1fr;
	}
	.sign {
		text-align: center;
		color: var(--faint);
		user-select: none;
	}
	.tx {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding-right: 12px;
	}
	.ctx .tx {
		color: var(--graphite);
	}
	.add {
		background: var(--add);
	}
	.add .sign,
	.add .tx {
		color: var(--add-ink);
	}
	.del {
		background: var(--del);
	}
	.del .sign,
	.del .tx {
		color: var(--del-ink);
	}
	.gap {
		padding: 2px 12px;
		font-family: var(--sans);
		font-size: 12px;
		color: var(--faint);
		background: var(--sunken);
		border-block: 1px solid var(--rule);
	}
</style>
