import { and, eq, gt } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '../db';
import { sectionLock, user } from '../db/schema';
import { loadSection } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { clock, LOCK_DEFAULT_MINUTES, LOCK_MAX_MINUTES, type Actor } from './types';

export async function getActiveLock(db: DbOrTx, sectionId: string) {
	const [row] = await db
		.select({
			sectionId: sectionLock.sectionId,
			holderId: sectionLock.holderId,
			holderName: user.name,
			actorKind: sectionLock.actorKind,
			purpose: sectionLock.purpose,
			acquiredAt: sectionLock.acquiredAt,
			expiresAt: sectionLock.expiresAt
		})
		.from(sectionLock)
		.innerJoin(user, eq(user.id, sectionLock.holderId))
		.where(and(eq(sectionLock.sectionId, sectionId), gt(sectionLock.expiresAt, clock.now())));
	return row ?? null;
}

export type ActiveLock = NonNullable<Awaited<ReturnType<typeof getActiveLock>>>;

export const lockDetails = (lock: ActiveLock) => ({
	heldBy: lock.holderName,
	heldByUserId: lock.holderId,
	via: lock.actorKind,
	purpose: lock.purpose,
	expiresAt: lock.expiresAt.toISOString()
});

/** Hibát dob, ha a szakaszt más tartja zárva. A saját zár (emberként vagy Claude-on át) nem akadály. */
export async function assertNotLockedByOther(tx: Tx, actor: Actor, sectionId: string) {
	const lock = await getActiveLock(tx, sectionId);
	if (lock && lock.holderId !== actor.userId) {
		throw new CoreError(
			'SECTION_LOCKED',
			`A szakaszt ${lock.holderName} foglalja ${lock.expiresAt.toISOString()}-ig (${lock.purpose || 'nincs megadva, mit csinál'}). Megjegyzést tehetsz, vagy várj a lejáratig.`,
			lockDetails(lock)
		);
	}
	return lock;
}

export interface LockInput {
	sectionId: string;
	minutes?: number;
	purpose?: string;
}

/** Lefoglalja vagy meghosszabbítja a zárat. Más élő zárja esetén SECTION_LOCKED. */
export async function lockSection(db: Db, actor: Actor, input: LockInput) {
	const minutes = input.minutes ?? LOCK_DEFAULT_MINUTES;
	if (!(minutes > 0 && minutes <= LOCK_MAX_MINUTES)) {
		throw new CoreError('VALIDATION', `A zár ideje 1 és ${LOCK_MAX_MINUTES} perc között lehet.`);
	}
	return db.transaction(async (tx) => {
		const ctx = await loadSection(tx, actor, input.sectionId, 'editor', { forUpdate: true });
		if (ctx.section.deletedAt) throw new CoreError('IN_TRASH', 'A szakasz a lomtárban van.');
		const existing = await assertNotLockedByOther(tx, actor, input.sectionId);
		const now = clock.now();
		const expiresAt = new Date(now.getTime() + minutes * 60_000);
		const values = {
			sectionId: input.sectionId,
			holderId: actor.userId,
			actorKind: actor.kind,
			purpose: input.purpose ?? existing?.purpose ?? '',
			acquiredAt: existing?.acquiredAt ?? now,
			expiresAt
		};
		await tx
			.insert(sectionLock)
			.values(values)
			.onConflictDoUpdate({ target: sectionLock.sectionId, set: values });
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: existing ? 'section.lock_extended' : 'section.locked',
			targetType: 'section',
			targetId: input.sectionId,
			summary: `${existing ? 'Zár meghosszabbítva' : 'Zár'}: „${ctx.section.title}” (${values.purpose || 'munka'})`,
			data: { expiresAt: expiresAt.toISOString() }
		});
		return {
			sectionId: input.sectionId,
			revision: ctx.section.revision,
			expiresAt,
			extended: !!existing
		};
	});
}

/**
 * Feloldja a zárat. Másét csak `force`-szal, és csak a munkatér tulajdonosa (ember) oldhatja fel.
 */
export async function releaseSection(
	db: Db,
	actor: Actor,
	input: { sectionId: string; force?: boolean }
) {
	return db.transaction(async (tx) => {
		const ctx = await loadSection(tx, actor, input.sectionId, 'editor', { forUpdate: true });
		const lock = await getActiveLock(tx, input.sectionId);
		if (!lock) return { released: false };
		if (lock.holderId !== actor.userId) {
			if (!input.force) {
				throw new CoreError('SECTION_LOCKED', `A zárat ${lock.holderName} tartja, nem te.`, lockDetails(lock));
			}
			if (ctx.role !== 'owner' || actor.kind !== 'human') {
				throw new CoreError('FORBIDDEN', 'Más zárját csak a munkatér tulajdonosa oldhatja fel, a felületről.');
			}
		}
		await tx.delete(sectionLock).where(eq(sectionLock.sectionId, input.sectionId));
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: lock.holderId === actor.userId ? 'section.unlocked' : 'section.lock_forced',
			targetType: 'section',
			targetId: input.sectionId,
			summary:
				lock.holderId === actor.userId
					? `Zár feloldva: „${ctx.section.title}”`
					: `${lock.holderName} zárja kényszerrel feloldva: „${ctx.section.title}”`,
			data: { previousHolderId: lock.holderId }
		});
		return { released: true };
	});
}
