import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { idea, ideaVote, user } from '../db/schema';
import { loadProject, loadSection } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { clock, type Actor } from './types';

export type IdeaStatus = 'new' | 'investigating' | 'adopted' | 'rejected';

const normTags = (tags: string[] | undefined) =>
	[...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);

export async function addIdea(
	db: Db,
	actor: Actor,
	input: { projectId: string; title: string; body?: string; tags?: string[] }
) {
	const title = input.title?.trim();
	if (!title) throw new CoreError('VALIDATION', 'Az ötletnek cím kell.');
	return db.transaction(async (tx) => {
		const { project } = await loadProject(tx, actor, input.projectId, 'editor');
		const [i] = await tx
			.insert(idea)
			.values({
				projectId: project.id,
				title,
				body: input.body ?? '',
				tags: normTags(input.tags),
				authorId: actor.userId,
				actorKind: actor.kind
			})
			.returning();
		await recordEvent(tx, actor, {
			projectId: project.id,
			type: 'idea.created',
			targetType: 'idea',
			targetId: i.id,
			summary: `Új ötlet: „${title}”`
		});
		return i;
	});
}

export async function listIdeas(
	db: DbOrTx,
	actor: Actor,
	input: { projectId: string; status?: IdeaStatus[]; tag?: string }
) {
	await loadProject(db, actor, input.projectId, 'viewer');
	const conds = [eq(idea.projectId, input.projectId)];
	if (input.status?.length) conds.push(inArray(idea.status, input.status));
	if (input.tag) conds.push(sql`${input.tag.trim().toLowerCase()} = any(${idea.tags})`);
	const votes = sql<number>`coalesce((select sum(${ideaVote.value}) from ${ideaVote} where ${ideaVote.ideaId} = ${idea.id}), 0)::int`;
	const myVote = sql<number>`coalesce((select ${ideaVote.value} from ${ideaVote} where ${ideaVote.ideaId} = ${idea.id} and ${ideaVote.userId} = ${actor.userId}), 0)::int`;
	return db
		.select({
			id: idea.id,
			title: idea.title,
			body: idea.body,
			tags: idea.tags,
			status: idea.status,
			by: user.name,
			via: idea.actorKind,
			votes,
			myVote,
			adoptedSectionId: idea.adoptedSectionId,
			createdAt: idea.createdAt
		})
		.from(idea)
		.innerJoin(user, eq(user.id, idea.authorId))
		.where(and(...conds))
		.orderBy(desc(votes), desc(idea.createdAt));
}

/** Szavazat: +1 támogat, -1 ellenez, 0 visszavonja. Felhasználónként egy szavazat ötletenként. */
export async function voteIdea(db: Db, actor: Actor, input: { ideaId: string; value: -1 | 0 | 1 }) {
	return db.transaction(async (tx) => {
		const [i] = await tx.select().from(idea).where(eq(idea.id, input.ideaId));
		if (!i) throw new CoreError('NOT_FOUND', 'Nincs ilyen ötlet.');
		await loadProject(tx, actor, i.projectId, 'editor');
		if (input.value === 0) {
			await tx.delete(ideaVote).where(and(eq(ideaVote.ideaId, i.id), eq(ideaVote.userId, actor.userId)));
		} else {
			await tx
				.insert(ideaVote)
				.values({ ideaId: i.id, userId: actor.userId, value: input.value })
				.onConflictDoUpdate({ target: [ideaVote.ideaId, ideaVote.userId], set: { value: input.value } });
		}
		const [{ total }] = await tx
			.select({ total: sql<number>`coalesce(sum(${ideaVote.value}), 0)::int` })
			.from(ideaVote)
			.where(eq(ideaVote.ideaId, i.id));
		await recordEvent(tx, actor, {
			projectId: i.projectId,
			type: 'idea.voted',
			targetType: 'idea',
			targetId: i.id,
			summary: `Szavazat: „${i.title}” (${input.value > 0 ? '+1' : input.value < 0 ? '−1' : 'visszavonva'}, összesen ${total})`
		});
		return { votes: total };
	});
}

export async function updateIdeaStatus(
	db: Db,
	actor: Actor,
	input: { ideaId: string; status: IdeaStatus; adoptedSectionId?: string }
) {
	return db.transaction(async (tx) => {
		const [i] = await tx.select().from(idea).where(eq(idea.id, input.ideaId)).for('update');
		if (!i) throw new CoreError('NOT_FOUND', 'Nincs ilyen ötlet.');
		await loadProject(tx, actor, i.projectId, 'editor');
		if (input.adoptedSectionId) {
			const ctx = await loadSection(tx, actor, input.adoptedSectionId, 'viewer');
			if (ctx.project.id !== i.projectId) throw new CoreError('VALIDATION', 'A szakasz másik projektben van.');
		}
		await tx
			.update(idea)
			.set({
				status: input.status,
				adoptedSectionId: input.status === 'adopted' ? (input.adoptedSectionId ?? i.adoptedSectionId) : i.adoptedSectionId,
				updatedAt: clock.now()
			})
			.where(eq(idea.id, i.id));
		await recordEvent(tx, actor, {
			projectId: i.projectId,
			type: 'idea.status_changed',
			targetType: 'idea',
			targetId: i.id,
			summary: `Ötlet: „${i.title}” ${i.status} → ${input.status}`
		});
	});
}
