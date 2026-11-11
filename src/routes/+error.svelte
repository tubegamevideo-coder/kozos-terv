<script lang="ts">
	import { page } from '$app/state';
	import AuthCard from '../lib/components/AuthCard.svelte';
</script>

<svelte:head><title>Hiba – Közös tervező</title></svelte:head>

<AuthCard>
	<h1>{page.status === 404 ? 'Nincs ilyen oldal' : page.status === 403 ? 'Ehhez nincs jogod' : 'Hiba történt'}</h1>
	<p class="muted">{page.error?.message}</p>
	<p><a class="btn quiet" href="/">Vissza a projektekhez</a></p>
</AuthCard>
