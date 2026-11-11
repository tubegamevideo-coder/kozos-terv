import { and, asc, eq, isNull } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { getDb } from '../../../../lib/server/db/client';
import { document } from '../../../../lib/server/db/schema';
import { humanActor, orError } from '../../../../lib/server/web';
import { listProposals, listQuestions } from '../../../../lib/server/core';
import { loadProject } from '../../../../lib/server/core/access';

export const load: LayoutServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const { project, role } = await orError(loadProject(db, actor, params.projectId, 'viewer'));
	const [proposals, questions, docs] = await Promise.all([
		listProposals(db, actor, { projectId: project.id, status: ['open'] }),
		listQuestions(db, actor, { projectId: project.id, status: ['open', 'disputed'] }),
		db
			.select({ id: document.id, title: document.title, kind: document.kind, isProtected: document.isProtected })
			.from(document)
			.where(and(eq(document.projectId, project.id), isNull(document.deletedAt)))
			.orderBy(asc(document.position), asc(document.createdAt))
	]);
	return {
		project: { id: project.id, name: project.name, goal: project.goal },
		role,
		projectNav: {
			id: project.id,
			name: project.name,
			docs,
			counts: {
				proposals: proposals.length,
				questions: questions.length,
				disputed: questions.filter((q) => q.status === 'disputed').length
			}
		}
	};
};
