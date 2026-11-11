<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Belépés – Közös tervező</title></svelte:head>

<main class="card">
	<h1>Közös tervező</h1>
	<p class="muted">Lépj be a Google-fiókoddal. Csak meghívott tagok léphetnek be.</p>
	{#if data.error}<p class="error">{data.error}</p>{/if}
	<a class="button" href={`/auth/google?next=${encodeURIComponent(data.next)}`}>Belépés Google-fiókkal</a>
</main>
