import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { humanActor, orError, orFail, str } from '../../../../../lib/server/web';
import { addComment, addQuestion, listComments, listQuestions, logDecision, updateQuestion, type QuestionStatus } from '../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const questions = await orError(listQuestions(db, actor, { projectId: params.projectId }));
	const withComments = await Promise.all(
		questions.map(async (q) => ({ ...q, comments: await listComments(db, actor, { questionId: q.id }) }))
	);
	return { questions: withComments };
};

export const actions: Actions = {
	add: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(addQuestion(getDb(), actor, { projectId: params.projectId, title: str(f, 'title'), body: str(f, 'body') }));
		return r.ok ? { ok: 'Kérdés felvéve.' } : r.failure;
	},
	status: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(updateQuestion(getDb(), actor, { questionId: str(f, 'questionId'), status: str(f, 'status') as QuestionStatus }));
		return r.ok ? { ok: 'Állapot módosítva.' } : r.failure;
	},
	decide: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(
			logDecision(getDb(), actor, {
				projectId: params.projectId,
				questionId: str(f, 'questionId'),
				title: str(f, 'title'),
				decision: str(f, 'decision'),
				rationale: str(f, 'rationale')
			})
		);
		return r.ok ? { ok: 'Döntés rögzítve a döntésnaplóban.' } : r.failure;
	},
	comment: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(addComment(getDb(), actor, { questionId: str(f, 'questionId'), body: str(f, 'body') }));
		return r.ok ? { ok: 'Hozzászólás elküldve.' } : r.failure;
	}
};
