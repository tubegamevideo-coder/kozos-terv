<script lang="ts">
	import type { PageProps } from './$types';
	import AuthCard from '../../../lib/components/AuthCard.svelte';
	import Avatar from '../../../lib/components/Avatar.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Hozzáférés engedélyezése – Közös tervező</title></svelte:head>

<AuthCard>
	<h1>Engedélyezed a hozzáférést?</h1>
	<p class="muted"><strong class="ink">{data.clientName}</strong> szeretne hozzáférni a közös tervezőhöz a nevedben.</p>
	<div class="who">
		<Avatar name={data.user.name} claude size={34} />
		<div>
			<p class="nm">{data.user.name}</p>
			<p class="faint small">{data.user.email}</p>
		</div>
	</div>
	<ul class="small what">
		<li>Olvashatja és szerkesztheti mindazt, amihez neked hozzáférésed van.</li>
		<li>Amit ír, a te neveden, Claude-jelöléssel jelenik meg.</li>
		<li>Védett dokumentumokba csak javasolhat.</li>
		<li>A kapcsolatot bármikor bonthatod a főoldalon.</li>
	</ul>
	<p class="faint tiny">Visszairányítás ide: <code>{data.redirectHost}</code></p>
	<form method="POST" class="acts">
		<button name="decision" value="deny" class="btn quiet">Elutasítom</button>
		<button name="decision" value="approve" class="btn">Engedélyezem</button>
	</form>
</AuthCard>

<style>
	.ink {
		color: var(--ink);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 20px 0;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--sunken);
	}
	.who p {
		margin: 0;
	}
	.nm {
		font-weight: 600;
	}
	.what {
		padding-left: 18px;
		color: var(--graphite);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}
</style>
