import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { question, user } from '../db/schema';
import { loadProject } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { clock, type Actor } from './types';

export type QuestionStatus = 'open' | 'disputed' | 'decided';

export interface AddQuestionInput {
	projectId: string;
	title: string;
	body?: string;
	relatedSectionIds?: string[];
}

export async function addQuestion(db: Db, actor: Actor, input: AddQuestionInput) {
	const title = input.title?.trim();
	if (!title) throw new CoreError('VALIDATION', 'A kérdésnek cím kell.');
	return db.transaction(async (tx) => {
		const { project } = await loadProject(tx, actor, input.projectId, 'editor');
		const [q] = await tx
			.insert(question)
			.values({
				projectId: project.id,
				title,
				body: input.body ?? '',
				raisedBy: actor.userId,
				actorKind: actor.kind,
				relatedSectionIds: input.relatedSectionIds ?? []
			})
			.returning();
		await recordEvent(tx, actor, {
			projectId: project.id,
			type: 'question.created',
			targetType: 'question',
			targetId: q.id,
			summary: `Új kérdés: „${title}”`
		});
		return q;
	});
}

export interface UpdateQuestionInput {
	questionId: string;
	status?: QuestionStatus;
	decision?: string;
	body?: string;
	relatedSectionIds?: string[];
}

/** Állapot, döntés, leírás vagy kapcsolódó szakaszok módosítása. „Eldőlt” állapothoz döntés kell. */
export async function updateQuestion(db: Db, actor: Actor, input: UpdateQuestionInput) {
	return db.transaction(async (tx) => {
		const [q] = await tx.select().from(question).where(eq(question.id, input.questionId)).for('update');
		if (!q) throw new CoreError('NOT_FOUND', 'Nincs ilyen kérdés.', { questionId: input.questionId });
		await loadProject(tx, actor, q.projectId, 'editor');
		const status = input.status ?? q.status;
		const decision = input.decision?.trim() || q.decision;
		if (status === 'decided' && !decision) {
			throw new CoreError('VALIDATION', 'Az „eldőlt” állapothoz meg kell adni a döntést (decision).');
		}
		const now = clock.now();
		const becameDecided = status === 'decided' && (q.status !== 'decided' || decision !== q.decision);
		const [updated] = await tx
			.update(question)
			.set({
				status,
				decision,
				body: input.body ?? q.body,
				relatedSectionIds: input.relatedSectionIds ?? q.relatedSectionIds,
				...(becameDecided ? { decidedBy: actor.userId, decidedAt: now } : {}),
				...(status !== 'decided' ? { decidedBy: null, decidedAt: null } : {}),
				updatedAt: now
			})
			.where(eq(question.id, q.id))
			.returning();
		await recordEvent(tx, actor, {
			projectId: q.projectId,
			type: becameDecided ? 'question.decided' : 'question.updated',
			targetType: 'question',
			targetId: q.id,
			summary: becameDecided
				? `Eldőlt: „${q.title}” – ${decision}`
				: `Kérdés módosítva: „${q.title}”${status !== q.status ? ` (${q.status} → ${status})` : ''}`
		});
		return updated;
	});
}

export async function listQuestions(
	db: DbOrTx,
	actor: Actor,
	input: { projectId: string; status?: QuestionStatus[] }
) {
	await loadProject(db, actor, input.projectId, 'viewer');
	const conds = [eq(question.projectId, input.projectId)];
	if (input.status?.length) conds.push(inArray(question.status, input.status));
	return db
		.select({
			id: question.id,
			title: question.title,
			body: question.body,
			status: question.status,
			decision: question.decision,
			raisedBy: user.name,
			via: question.actorKind,
			relatedSectionIds: question.relatedSectionIds,
			updatedAt: question.updatedAt
		})
		.from(question)
		.innerJoin(user, eq(user.id, question.raisedBy))
		.where(and(...conds))
		.orderBy(
			sql`case ${question.status} when 'disputed' then 0 when 'open' then 1 else 2 end`,
			desc(question.updatedAt),
			asc(question.id)
		);
}
