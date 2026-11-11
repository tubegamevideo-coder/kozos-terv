import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../lib/server/db/client';
import { getAuthConfig } from '../../lib/server/auth/config';
import { disconnectClient, listConnectedClients } from '../../lib/server/auth/oauth';
import {
	CoreError,
	inviteMember,
	listMyWorkspaces,
	listPendingInvitations,
	listProjects,
	revokeInvitation,
	type Actor,
	type Role
} from '../../lib/server/core';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const db = getDb();
	const actor: Actor = { userId: locals.user.id, kind: 'human' };
	const workspaces = await listMyWorkspaces(db, locals.user.id);
	const invitations = await Promise.all(
		workspaces.filter((w) => w.role === 'owner').map(async (w) => ({ ...w, pending: await listPendingInvitations(db, actor, w.id) }))
	);
	return {
		mcpUrl: getAuthConfig().mcpResource,
		projects: await listProjects(db, actor, { channel: 'web' }),
		clients: await listConnectedClients(db, locals.user.id),
		ownedWorkspaces: invitations
	};
};

const actorOf = (locals: App.Locals): Actor => {
	if (!locals.user) redirect(303, '/login');
	return { userId: locals.user.id, kind: 'human' };
};

export const actions: Actions = {
	disconnect: async ({ request, locals }) => {
		const actor = actorOf(locals);
		const clientId = String((await request.formData()).get('clientId') ?? '');
		await disconnectClient(getDb(), actor.userId, clientId);
		return { ok: 'A kapcsolat visszavonva.' };
	},
	invite: async ({ request, locals }) => {
		const actor = actorOf(locals);
		const f = await request.formData();
		try {
			const r = await inviteMember(getDb(), actor, {
				workspaceId: String(f.get('workspaceId')),
				email: String(f.get('email') ?? ''),
				role: (String(f.get('role') ?? 'editor') as Role)
			});
			return { ok: r.status === 'member' ? `${r.email} már felhasználó, taggá tettem.` : `Meghívó elküldve: ${r.email}. Belépés után tag lesz.` };
		} catch (e) {
			if (e instanceof CoreError) return fail(400, { error: e.message });
			throw e;
		}
	},
	revokeInvite: async ({ request, locals }) => {
		const actor = actorOf(locals);
		await revokeInvitation(getDb(), actor, String((await request.formData()).get('invitationId')));
		return { ok: 'Meghívó visszavonva.' };
	}
};
