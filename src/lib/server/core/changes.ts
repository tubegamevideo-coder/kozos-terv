import { and, asc, desc, eq, gt, gte, max } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { event, projectVisit, user } from '../db/schema';
import { loadProject } from './access';
import { clock, type Actor } from './types';

export type VisitChannel = 'web' | 'mcp';

export interface ChangesInput {
	projectId: string;
	/** Ennél nagyobb azonosítójú események (kurzor). */
	afterEventId?: number;
	/** Vagy: ettől az időponttól. */
	since?: Date;
	limit?: number;
}

/** A projekt eseményei időrendben, a kurzor után. A `nextCursor` a következő hívás `afterEventId`-je. */
export async function getChanges(db: DbOrTx, actor: Actor, input: ChangesInput) {
	await loadProject(db, actor, input.projectId, 'viewer');
	const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
	const conds = [eq(event.projectId, input.projectId)];
	if (input.afterEventId !== undefined) conds.push(gt(event.id, input.afterEventId));
	if (input.since) conds.push(gte(event.createdAt, input.since));
	const rows = await db
		.select({
			id: event.id,
			type: event.type,
			targetType: event.targetType,
			targetId: event.targetId,
			summary: event.summary,
			data: event.data,
			by: user.name,
			byUserId: event.actorId,
			via: event.actorKind,
			at: event.createdAt
		})
		.from(event)
		.innerJoin(user, eq(user.id, event.actorId))
		.where(and(...conds))
		.orderBy(asc(event.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit);
	return {
		items,
		hasMore,
		nextCursor: items.length ? items[items.length - 1].id : (input.afterEventId ?? 0)
	};
}

export async function getLastVisit(db: DbOrTx, userId: string, projectId: string, channel: VisitChannel) {
	const [v] = await db
		.select()
		.from(projectVisit)
		.where(
			and(eq(projectVisit.userId, userId), eq(projectVisit.projectId, projectId), eq(projectVisit.channel, channel))
		);
	return v ?? null;
}

/**
 * Rögzíti, hogy a felhasználó idáig látta a projektet. A kurzor sosem megy vissza.
 * Ha `upToEventId` nincs megadva, a projekt legutolsó eseményéig.
 */
export async function markVisit(
	db: Db,
	actor: Actor,
	input: { projectId: string; channel: VisitChannel; upToEventId?: number }
) {
	await loadProject(db, actor, input.projectId, 'viewer');
	let upTo = input.upToEventId;
	if (upTo === undefined) {
		const [r] = await db.select({ m: max(event.id) }).from(event).where(eq(event.projectId, input.projectId));
		upTo = r?.m ?? 0;
	}
	const now = clock.now();
	const prev = await getLastVisit(db, actor.userId, input.projectId, input.channel);
	const lastEventId = Math.max(prev?.lastEventId ?? 0, upTo);
	await db
		.insert(projectVisit)
		.values({ userId: actor.userId, projectId: input.projectId, channel: input.channel, lastEventId, lastVisitedAt: now })
		.onConflictDoUpdate({
			target: [projectVisit.userId, projectVisit.projectId, projectVisit.channel],
			set: { lastEventId, lastVisitedAt: now }
		});
	return { lastEventId };
}

/** Mások változásai az utolsó látogatás óta (a saját írások nem „újdonságok”). */
export async function getChangesSinceLastVisit(
	db: DbOrTx,
	actor: Actor,
	input: { projectId: string; channel: VisitChannel; limit?: number }
) {
	const visit = await getLastVisit(db, actor.userId, input.projectId, input.channel);
	const res = await getChanges(db, actor, {
		projectId: input.projectId,
		afterEventId: visit?.lastEventId ?? 0,
		limit: input.limit
	});
	return {
		lastVisitedAt: visit?.lastVisitedAt ?? null,
		...res,
		items: res.items.filter((e) => e.byUserId !== actor.userId)
	};
}

export async function latestEventId(db: DbOrTx, projectId: string) {
	const [r] = await db
		.select({ id: event.id })
		.from(event)
		.where(eq(event.projectId, projectId))
		.orderBy(desc(event.id))
		.limit(1);
	return r?.id ?? 0;
}
