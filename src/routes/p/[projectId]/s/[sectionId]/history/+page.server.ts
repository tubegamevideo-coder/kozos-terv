import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../../lib/server/db/client';
import { humanActor, int, orError, orFail, str } from '../../../../../../lib/server/web';
import { compareRevisions, listRevisions, readSection, restoreRevision } from '../../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const section = await orError(readSection(db, actor, params.sectionId));
	const revisions = await listRevisions(db, actor, params.sectionId);
	const latest = revisions[0]?.revision ?? 1;
	const b = Number(url.searchParams.get('b') ?? latest);
	const a = Number(url.searchParams.get('a') ?? Math.max(1, b - 1));
	const cmp = await orError(compareRevisions(db, actor, { sectionId: params.sectionId, from: a, to: b }));
	return { section, revisions, a, b, cmp };
};

export const actions: Actions = {
	restore: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(
			restoreRevision(getDb(), actor, {
				sectionId: params.sectionId,
				baseRevision: int(f, 'baseRevision'),
				toRevision: int(f, 'toRevision'),
				reason: str(f, 'reason') || `visszaállítás a ${str(f, 'toRevision')}. revízióra`
			})
		);
		if (!r.ok) return r.failure;
		redirect(303, url.pathname);
	}
};
