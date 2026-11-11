<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	let { value, label }: { value: string; label?: string } = $props();
	let copied = $state(false);
	async function copy() {
		await navigator.clipboard.writeText(value);
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}
</script>

<div class="copy">
	<code class="grow" aria-label={label}>{value}</code>
	<button class="btn quiet sm" type="button" onclick={copy}>
		{#if copied}<Check size={14} /> Másolva{:else}<Copy size={14} /> Másolás{/if}
	</button>
</div>

<style>
	.copy {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 4px 4px 12px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--r-sm);
		background: var(--sunken);
	}
	code {
		font-size: 13px;
		overflow-x: auto;
		white-space: nowrap;
	}
</style>
