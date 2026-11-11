import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { comment, proposal, question, user } from '../db/schema';
import { loadDocument, loadProject, loadSection } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { clock, type Actor } from './types';

/** Mihez tartozik a megjegyzés: pontosan egy legyen megadva. */
export interface CommentTarget {
	sectionId?: string;
	questionId?: string;
	proposalId?: string;
}

/** Feloldja a célt projektre, és ellenőrzi az olvasási jogot (megjegyzést olvasó is írhat). */
async function resolveTarget(db: DbOrTx, actor: Actor, t: CommentTarget) {
	const given = [t.sectionId, t.questionId, t.proposalId].filter(Boolean);
	if (given.length !== 1) {
		throw new CoreError('VALIDATION', 'Pontosan egy cél kell: sectionId, questionId vagy proposalId.');
	}
	if (t.sectionId) {
		const ctx = await loadSection(db, actor, t.sectionId, 'viewer');
		return { projectId: ctx.project.id, label: `„${ctx.section.title}” szakasz` };
	}
	if (t.questionId) {
		const [q] = await db.select().from(question).where(eq(question.id, t.questionId));
		if (!q) throw new CoreError('NOT_FOUND', 'Nincs ilyen kérdés.');
		await loadProject(db, actor, q.projectId, 'viewer');
		return { projectId: q.projectId, label: `„${q.title}” kérdés` };
	}
	const [p] = await db.select().from(proposal).where(eq(proposal.id, t.proposalId!));
	if (!p) throw new CoreError('NOT_FOUND', 'Nincs ilyen javaslat.');
	const ctx = await loadDocument(db, actor, p.documentId, 'viewer');
	return { projectId: ctx.project.id, label: `„${p.proposedTitle}” javaslat` };
}

export interface AddCommentInput extends CommentTarget {
	body: string;
	/** Válasz egy meglévő megjegyzésre (ugyanazon a célon). */
	parentId?: string;
}

/** Megjegyzés: zárolt és védett szakaszra is lehet, olvasó szerepkörrel is. */
export async function addComment(db: Db, actor: Actor, input: AddCommentInput) {
	const body = input.body?.trim();
	if (!body) throw new CoreError('VALIDATION', 'A megjegyzés nem lehet üres.');
	return db.transaction(async (tx) => {
		const target = await resolveTarget(tx, actor, input);
		if (input.parentId) {
			const [parent] = await tx.select().from(comment).where(eq(comment.id, input.parentId));
			const same =
				parent &&
				parent.sectionId === (input.sectionId ?? null) &&
				parent.questionId === (input.questionId ?? null) &&
				parent.proposalId === (input.proposalId ?? null);
			if (!same) throw new CoreError('VALIDATION', 'A szülő megjegyzés nem ugyanehhez a célhoz tartozik.');
		}
		const [c] = await tx
			.insert(comment)
			.values({
				projectId: target.projectId,
				sectionId: input.sectionId ?? null,
				questionId: input.questionId ?? null,
				proposalId: input.proposalId ?? null,
				parentId: input.parentId ?? null,
				authorId: actor.userId,
				actorKind: actor.kind,
				body
			})
			.returning();
		await recordEvent(tx, actor, {
			projectId: target.projectId,
			type: 'comment.created',
			targetType: 'comment',
			targetId: c.id,
			summary: `Megjegyzés (${target.label}): ${body.length > 120 ? body.slice(0, 117) + '…' : body}`,
			data: { sectionId: c.sectionId, questionId: c.questionId, proposalId: c.proposalId, parentId: c.parentId }
		});
		return c;
	});
}

export async function listComments(
	db: DbOrTx,
	actor: Actor,
	input: CommentTarget & { includeResolved?: boolean }
) {
	await resolveTarget(db, actor, input);
	const conds = [isNull(comment.deletedAt)];
	if (input.sectionId) conds.push(eq(comment.sectionId, input.sectionId));
	if (input.questionId) conds.push(eq(comment.questionId, input.questionId));
	if (input.proposalId) conds.push(eq(comment.proposalId, input.proposalId));
	const rows = await db
		.select({
			id: comment.id,
			parentId: comment.parentId,
			body: comment.body,
			by: user.name,
			via: comment.actorKind,
			resolved: comment.resolvedAt,
			createdAt: comment.createdAt
		})
		.from(comment)
		.innerJoin(user, eq(user.id, comment.authorId))
		.where(and(...conds))
		.orderBy(asc(comment.createdAt), asc(comment.id));
	// Szálak: a gyökérhez tartozó válaszok a gyökér alatt.
	const roots = rows.filter((r) => !r.parentId);
	const threads = roots
		.filter((r) => input.includeResolved || !r.resolved)
		.map((r) => ({ ...r, resolved: !!r.resolved, replies: [] as typeof rows }));
	const byId = new Map(threads.map((t) => [t.id, t]));
	for (const r of rows) {
		if (!r.parentId) continue;
		let root = rows.find((x) => x.id === r.parentId);
		while (root?.parentId) root = rows.find((x) => x.id === root!.parentId);
		if (root) byId.get(root.id)?.replies.push(r);
	}
	return threads;
}

/** Szál lezárása (vagy újranyitása). */
export async function resolveComment(db: Db, actor: Actor, input: { commentId: string; resolved?: boolean }) {
	return db.transaction(async (tx) => {
		const [c] = await tx.select().from(comment).where(eq(comment.id, input.commentId)).for('update');
		if (!c) throw new CoreError('NOT_FOUND', 'Nincs ilyen megjegyzés.');
		await loadProject(tx, actor, c.projectId, 'editor');
		const resolved = input.resolved ?? true;
		await tx
			.update(comment)
			.set(resolved ? { resolvedAt: clock.now(), resolvedBy: actor.userId } : { resolvedAt: null, resolvedBy: null })
			.where(eq(comment.id, c.id));
		await recordEvent(tx, actor, {
			projectId: c.projectId,
			type: resolved ? 'comment.resolved' : 'comment.reopened',
			targetType: 'comment',
			targetId: c.id,
			summary: resolved ? 'Megjegyzésszál lezárva' : 'Megjegyzésszál újranyitva'
		});
	});
}
