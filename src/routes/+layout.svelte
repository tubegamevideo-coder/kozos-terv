<script lang="ts">
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

{@render children()}

<style>
	:global(:root) {
		color-scheme: light dark;
		--bg: #f7f7f5; --fg: #1d1d1b; --muted: #6b6b66; --line: #ddddd8; --accent: #14998c; --danger: #b3261e; --card: #fff;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) { --bg: #161615; --fg: #ececea; --muted: #9a9a94; --line: #33332f; --card: #1f1f1d; }
	}
	:global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
	:global(main) { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
	:global(main.card) { max-width: 460px; margin-top: 12vh; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
	:global(header) { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
	:global(h1) { font-size: 1.5rem; margin: 0 0 8px; }
	:global(h2) { font-size: 1.1rem; margin: 28px 0 8px; }
	:global(h3) { font-size: 1rem; margin: 18px 0 6px; }
	:global(.muted) { color: var(--muted); }
	:global(.error) { color: var(--danger); }
	:global(.ok) { color: var(--accent); }
	:global(code) { background: color-mix(in srgb, var(--fg) 8%, transparent); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; word-break: break-all; }
	:global(table) { width: 100%; border-collapse: collapse; }
	:global(th), :global(td) { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
	:global(.button) { display: inline-block; background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; cursor: pointer; text-decoration: none; }
	:global(.button.secondary) { background: transparent; color: var(--fg); border: 1px solid var(--line); }
	:global(.link) { background: none; border: 0; color: var(--accent); cursor: pointer; font: inherit; padding: 0 4px; }
	:global(.danger) { color: var(--danger); }
	:global(form.row) { display: flex; gap: 8px; flex-wrap: wrap; }
	:global(form.inline) { display: inline; }
	:global(input), :global(select) { font: inherit; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); }
</style>
