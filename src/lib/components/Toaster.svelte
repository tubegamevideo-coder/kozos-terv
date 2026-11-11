<script lang="ts">
	import { dismiss, toasts } from '../toast.svelte';
	import { Check, CircleAlert, X } from '@lucide/svelte';
</script>

<div class="toaster" role="status" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" class:error={t.kind === 'error'}>
			{#if t.kind === 'error'}<CircleAlert size={16} />{:else}<Check size={16} />{/if}
			<span class="grow">{t.text}</span>
			<button class="x" onclick={() => dismiss(t.id)} aria-label="Bezárás"><X size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		right: 20px;
		bottom: 20px;
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: min(420px, calc(100vw - 40px));
	}
	.toast {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: var(--ink);
		color: var(--paper);
		box-shadow: var(--shadow-pop);
		font-size: 13.5px;
		animation: in 0.18s ease-out;
	}
	.toast :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--teal-wash);
	}
	.toast.error {
		background: var(--danger);
		color: #fff;
	}
	.toast.error :global(svg) {
		color: #fff;
	}
	.x {
		background: none;
		border: 0;
		padding: 0;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}
	@keyframes in {
		from {
			transform: translateY(6px);
			opacity: 0;
		}
	}
</style>
