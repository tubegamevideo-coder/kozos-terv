<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Hozzáférés engedélyezése – Közös tervező</title></svelte:head>

<main class="card">
	<h1>Hozzáférés engedélyezése</h1>
	<p>
		A(z) <strong>{data.clientName}</strong> (<code>{data.redirectHost}</code>) hozzáférést kér a
		közös tervezőhöz a te nevedben: <strong>{data.user.name}</strong> ({data.user.email}).
	</p>
	<p class="muted">
		Olvashatja és szerkesztheti mindazt, amihez neked is hozzáférésed van; minden írása a te
		neveden, „Claude” jelöléssel jelenik meg. A kapcsolatot bármikor visszavonhatod a főoldalon.
	</p>
	<form method="POST">
		<button name="decision" value="approve" class="button">Engedélyezem</button>
		<button name="decision" value="deny" class="button secondary">Elutasítom</button>
	</form>
</main>
