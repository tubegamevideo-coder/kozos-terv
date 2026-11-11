import type { LayoutServerLoad } from './$types';
import { getDb } from '../../lib/server/db/client';
import { humanActor } from '../../lib/server/web';
import { listProjects } from '../../lib/server/core';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const actor = humanActor(locals, url);
	const projects = await listProjects(getDb(), actor, { channel: 'web' });
	return {
		user: locals.user!,
		projects: projects.map((p) => ({ id: p.id, name: p.name, workspace: p.workspace, unseen: p.unseenChanges }))
	};
};
