<script lang="ts">
	let { lines }: { lines: { type: 'add' | 'del' | 'ctx'; text: string }[] } = $props();
</script>

<pre class="diffview">{#each lines as l, i (i)}<span class={l.type}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text}
</span>{/each}</pre>

<style>
	.diffview { white-space: pre-wrap; font: 12.5px/1.5 ui-monospace, monospace; border: 1px solid var(--line); border-radius: 8px; padding: 8px; max-height: 60vh; overflow: auto; }
	.add { background: color-mix(in srgb, #2da44e 18%, transparent); display: block; }
	.del { background: color-mix(in srgb, #cf222e 16%, transparent); display: block; text-decoration: line-through; text-decoration-color: color-mix(in srgb, #cf222e 50%, transparent); }
	.ctx { display: block; color: var(--muted); }
</style>
