<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import AuthCard from '../../../lib/components/AuthCard.svelte';
	import Avatar from '../../../lib/components/Avatar.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Hozzáférés engedélyezése – Teréz</title></svelte:head>

<AuthCard>
	<h1>Engedélyezed a hozzáférést?</h1>
	<p class="muted"><strong class="ink">{data.clientName}</strong> hozzáférést kér a nevedben Terézhez.</p>
	<p class="small lbl-who">Ezzel a fiókkal kapcsolódik:</p>
	<div class="who">
		<Avatar name={data.user.name} claude size={34} />
		<div class="grow">
			<p class="nm">{data.user.name}</p>
			<p class="faint small">{data.user.email}</p>
		</div>
		<form method="POST" action="/logout">
			<input type="hidden" name="next" value={page.url.pathname + page.url.search} />
			<button class="btn ghost sm">Nem én vagyok</button>
		</form>
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
	.lbl-who {
		margin: 20px 0 6px;
		font-weight: 500;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 0 20px;
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
