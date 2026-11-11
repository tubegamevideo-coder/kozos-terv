import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { humanActor, orError, orFail, str } from '../../../../../lib/server/web';
import { acceptProposal, listProposals, rejectProposal } from '../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const [open, resolved] = await Promise.all([
		orError(listProposals(db, actor, { projectId: params.projectId, status: ['open', 'conflicted'] })),
		orError(listProposals(db, actor, { projectId: params.projectId, status: ['accepted', 'rejected'], limit: 15 }))
	]);
	return { open, resolved };
};

export const actions: Actions = {
	accept: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(acceptProposal(getDb(), actor, { proposalId: str(f, 'proposalId'), note: str(f, 'note') || undefined }));
		return r.ok ? { ok: 'Javaslat elfogadva, bekerült a dokumentumba.' } : r.failure;
	},
	reject: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(rejectProposal(getDb(), actor, { proposalId: str(f, 'proposalId'), note: str(f, 'note') || undefined }));
		return r.ok ? { ok: 'Javaslat elutasítva.' } : r.failure;
	}
};
