import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { invitation, user, workspace, workspaceMember } from '../db/schema';
import { requireRole } from './access';
import { CoreError } from './errors';
import { clock, type Actor, type Role } from './types';

const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * Meghívás e-mail-címre. Ha a cím már felhasználó, azonnal taggá teszi; különben függő
 * meghívó jön létre, amit az első Google-belépés vált be.
 */
export async function inviteMember(
	db: Db,
	actor: Actor,
	input: { workspaceId: string; email: string; role: Role; days?: number }
) {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', 'Meghívni csak ember tud, a felületről.');
	const email = normEmail(input.email);
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CoreError('VALIDATION', 'Érvénytelen e-mail-cím.');
	await requireRole(db, actor, input.workspaceId, 'owner');
	return db.transaction(async (tx) => {
		const [existing] = await tx.select().from(user).where(eq(user.email, email));
		if (existing) {
			await tx
				.insert(workspaceMember)
				.values({ workspaceId: input.workspaceId, userId: existing.id, role: input.role })
				.onConflictDoUpdate({ target: [workspaceMember.workspaceId, workspaceMember.userId], set: { role: input.role } });
			return { status: 'member' as const, email };
		}
		const expiresAt = new Date(clock.now().getTime() + (input.days ?? 14) * 86_400_000);
		const [inv] = await tx
			.insert(invitation)
			.values({ workspaceId: input.workspaceId, email, role: input.role, invitedBy: actor.userId, expiresAt })
			.returning();
		return { status: 'invited' as const, email, invitationId: inv.id, expiresAt };
	});
}

export async function listPendingInvitations(db: Db, actor: Actor, workspaceId: string) {
	await requireRole(db, actor, workspaceId, 'owner');
	return db
		.select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
		.from(invitation)
		.where(
			and(
				eq(invitation.workspaceId, workspaceId),
				isNull(invitation.acceptedAt),
				isNull(invitation.revokedAt),
				gt(invitation.expiresAt, clock.now())
			)
		)
		.orderBy(desc(invitation.createdAt));
}

export async function revokeInvitation(db: Db, actor: Actor, invitationId: string) {
	const [inv] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
	if (!inv) throw new CoreError('NOT_FOUND', 'Nincs ilyen meghívó.');
	await requireRole(db, actor, inv.workspaceId, 'owner');
	await db.update(invitation).set({ revokedAt: clock.now() }).where(eq(invitation.id, invitationId));
}

export interface LoginProfile {
	email: string;
	name: string;
	image?: string | null;
}

/**
 * Google-belépés után: a felhasználó, ha beléphet. Beléphet, aki már tag valamelyik munkatérben,
 * vagy akinek érvényes meghívója van (ezt itt váltjuk be). Mindenki más: null.
 */
export async function resolveLoginUser(db: Db, profile: LoginProfile) {
	const email = normEmail(profile.email);
	return db.transaction(async (tx) => {
		const now = clock.now();
		const invites = await tx
			.select()
			.from(invitation)
			.where(
				and(eq(invitation.email, email), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gt(invitation.expiresAt, now))
			)
			.for('update');
		let [u] = await tx.select().from(user).where(eq(user.email, email));
		const memberships = u
			? await tx
					.select({ w: workspaceMember.workspaceId })
					.from(workspaceMember)
					.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
					.where(and(eq(workspaceMember.userId, u.id), isNull(workspace.deletedAt)))
			: [];
		if (!memberships.length && !invites.length) return null;

		if (!u) {
			[u] = await tx
				.insert(user)
				.values({ email, name: profile.name || email, image: profile.image ?? null, emailVerified: true })
				.returning();
		} else {
			await tx
				.update(user)
				.set({ emailVerified: true, image: profile.image ?? u.image, updatedAt: now })
				.where(eq(user.id, u.id));
		}
		for (const inv of invites) {
			await tx
				.insert(workspaceMember)
				.values({ workspaceId: inv.workspaceId, userId: u.id, role: inv.role })
				.onConflictDoNothing();
			await tx.update(invitation).set({ acceptedAt: now }).where(eq(invitation.id, inv.id));
		}
		return u;
	});
}

export async function listMyWorkspaces(db: Db, userId: string) {
	return db
		.select({ id: workspace.id, name: workspace.name, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(and(eq(workspaceMember.userId, userId), isNull(workspace.deletedAt)))
		.orderBy(workspace.name);
}
