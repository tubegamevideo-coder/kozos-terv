import type { LayoutServerLoad } from './$types';
import { getDb } from '../../../lib/server/db/client';
import { humanActor, orError } from '../../../lib/server/web';
import { listProposals, listQuestions } from '../../../lib/server/core';
import { loadProject } from '../../../lib/server/core/access';

export const load: LayoutServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const { project, role } = await orError(loadProject(db, actor, params.projectId, 'viewer'));
	const [proposals, questions] = await Promise.all([
		listProposals(db, actor, { projectId: project.id, status: ['open'] }),
		listQuestions(db, actor, { projectId: project.id, status: ['open', 'disputed'] })
	]);
	return {
		user: locals.user!,
		project: { id: project.id, name: project.name, goal: project.goal },
		role,
		counts: { proposals: proposals.length, questions: questions.length }
	};
};
