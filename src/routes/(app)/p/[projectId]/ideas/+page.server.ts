import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { humanActor, orError, orFail, str } from '../../../../../lib/server/web';
import { addIdea, listIdeas, updateIdeaStatus, voteIdea, type IdeaStatus } from '../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	return { ideas: await orError(listIdeas(getDb(), actor, { projectId: params.projectId, tag: url.searchParams.get('cimke') ?? undefined })), tag: url.searchParams.get('cimke') };
};

export const actions: Actions = {
	add: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const tags = str(f, 'tags').split(',').map((t) => t.trim()).filter(Boolean);
		const r = await orFail(addIdea(getDb(), actor, { projectId: params.projectId, title: str(f, 'title'), body: str(f, 'body'), tags }));
		return r.ok ? { ok: 'Ötlet felvéve.' } : r.failure;
	},
	vote: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(voteIdea(getDb(), actor, { ideaId: str(f, 'ideaId'), value: Number(str(f, 'value')) as -1 | 0 | 1 }));
		return r.ok ? {} : r.failure;
	},
	status: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(updateIdeaStatus(getDb(), actor, { ideaId: str(f, 'ideaId'), status: str(f, 'status') as IdeaStatus }));
		return r.ok ? {} : r.failure;
	}
};
