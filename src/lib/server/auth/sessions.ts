import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db';
import { session, user } from '../db/schema';
import { clock } from '../core/types';
import { randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = 'kt_session';

export async function createSession(db: Db, userId: string, ttlSec: number, userAgent?: string | null) {
	const token = randomToken('kts_');
	const expiresAt = new Date(clock.now().getTime() + ttlSec * 1000);
	await db.insert(session).values({ userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
	return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string | undefined | null) {
	if (!token) return null;
	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email, image: user.image, sessionId: session.id })
		.from(session)
		.innerJoin(user, eq(user.id, session.userId))
		.where(and(eq(session.tokenHash, sha256(token)), gt(session.expiresAt, clock.now())));
	return row ?? null;
}

export async function deleteSession(db: Db, token: string | undefined | null) {
	if (!token) return;
	await db.delete(session).where(eq(session.tokenHash, sha256(token)));
}
