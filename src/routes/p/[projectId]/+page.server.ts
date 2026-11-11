import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../lib/server/db/client';
import { humanActor, orError, orFail, str } from '../../../lib/server/web';
import { createDocument, getProjectBrief } from '../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const brief = await orError(getProjectBrief(getDb(), actor, { projectId: params.projectId, channel: 'web', changesLimit: 60 }));
	return { brief };
};

export const actions: Actions = {
	createDocument: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const kind = str(f, 'kind') as 'note' | 'research' | 'main_plan';
		const r = await orFail(createDocument(getDb(), actor, { projectId: params.projectId, title: str(f, 'title'), kind }));
		return r.ok ? { ok: `Létrehozva: ${r.value.title}` } : r.failure;
	}
};
