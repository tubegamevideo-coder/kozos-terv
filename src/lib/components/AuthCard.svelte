<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="wrap">
	<div class="card">
		<p class="brand"><span class="mark" aria-hidden="true"><i></i><i></i></span> Közös tervező</p>
		{@render children()}
	</div>
</div>

<style>
	.wrap {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	.card {
		width: min(440px, 100%);
		padding: 32px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 14px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 0 28px;
		font-weight: 600;
	}
	.mark {
		position: relative;
		width: 26px;
		height: 18px;
	}
	.mark i {
		position: absolute;
		top: 0;
		width: 18px;
		height: 18px;
		border-radius: 50%;
	}
	.mark i:first-child {
		left: 0;
		background: var(--teal);
	}
	.mark i:last-child {
		left: 8px;
		background: var(--claude);
		mix-blend-mode: multiply;
	}
	@media (prefers-color-scheme: dark) {
		.mark i:last-child {
			mix-blend-mode: screen;
		}
	}
	.card :global(h1) {
		font-size: 22px;
		letter-spacing: -0.02em;
		margin-bottom: 8px;
	}
</style>
