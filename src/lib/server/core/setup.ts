import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { document, project, workspace, workspaceMember } from '../db/schema';
import { loadDocument, loadProject, requireRole } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { clock, type Actor, type Role } from './types';

type DocumentKind = (typeof document.$inferInsert)['kind'] & string;

/** Új munkatér; a létrehozó lesz a tulajdonosa. */
export async function createWorkspace(db: Db, actor: Actor, input: { name: string; slug: string }) {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', 'Munkateret csak ember hozhat létre.');
	return db.transaction(async (tx) => {
		const [w] = await tx.insert(workspace).values({ name: input.name, slug: input.slug }).returning();
		await tx.insert(workspaceMember).values({ workspaceId: w.id, userId: actor.userId, role: 'owner' });
		return w;
	});
}

export async function setMember(
	db: Db,
	actor: Actor,
	input: { workspaceId: string; userId: string; role: Role }
) {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', 'Tagokat csak ember kezelhet.');
	await requireRole(db, actor, input.workspaceId, 'owner');
	await db
		.insert(workspaceMember)
		.values(input)
		.onConflictDoUpdate({
			target: [workspaceMember.workspaceId, workspaceMember.userId],
			set: { role: input.role }
		});
}

export async function createProject(
	db: Db,
	actor: Actor,
	input: { workspaceId: string; name: string; goal?: string; instructions?: string }
) {
	const name = input.name?.trim();
	if (!name) throw new CoreError('VALIDATION', 'A projektnek név kell.');
	await requireRole(db, actor, input.workspaceId, 'editor');
	return db.transaction(async (tx) => {
		const [p] = await tx
			.insert(project)
			.values({
				workspaceId: input.workspaceId,
				name,
				goal: input.goal ?? '',
				instructions: input.instructions ?? '',
				createdBy: actor.userId
			})
			.returning();
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'project.created',
			targetType: 'project',
			targetId: p.id,
			summary: `Új projekt: „${p.name}”`
		});
		return p;
	});
}

/** A projektutasítás (a Claude-nak szóló szabályok) csak emberi írással változhat. */
export async function updateProjectInstructions(
	db: Db,
	actor: Actor,
	input: { projectId: string; instructions: string }
) {
	if (actor.kind !== 'human') {
		throw new CoreError('HUMAN_ONLY', 'A projektutasítást csak ember módosíthatja; javasolj megjegyzésben.');
	}
	return db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'editor');
		await tx
			.update(project)
			.set({ instructions: input.instructions, updatedAt: clock.now() })
			.where(eq(project.id, p.id));
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'project.instructions_updated',
			targetType: 'project',
			targetId: p.id,
			summary: 'A projektutasítás módosult'
		});
	});
}

export async function createDocument(
	db: Db,
	actor: Actor,
	input: { projectId: string; title: string; kind?: DocumentKind; isProtected?: boolean }
) {
	const kind = input.kind ?? 'note';
	// A „fő terv” alapból védett; a védettséget kikapcsolni csak ember tudja.
	const isProtected = input.isProtected ?? kind === 'main_plan';
	if (!isProtected && kind === 'main_plan' && actor.kind === 'claude') {
		throw new CoreError('PROTECTED_DOCUMENT', 'Fő tervet a Claude csak védettként hozhat létre.');
	}
	return db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'editor');
		const [d] = await tx
			.insert(document)
			.values({ projectId: p.id, title: input.title, kind, isProtected, createdBy: actor.userId })
			.returning();
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'document.created',
			targetType: 'document',
			targetId: d.id,
			summary: `Új dokumentum: „${d.title}” (${kind}${isProtected ? ', védett' : ''})`
		});
		return d;
	});
}

export async function setDocumentProtection(
	db: Db,
	actor: Actor,
	input: { documentId: string; isProtected: boolean }
) {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', 'A védettséget csak ember állíthatja.');
	return db.transaction(async (tx) => {
		const ctx = await loadDocument(tx, actor, input.documentId, 'owner');
		await tx
			.update(document)
			.set({ isProtected: input.isProtected, updatedAt: clock.now() })
			.where(and(eq(document.id, input.documentId)));
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'document.protection_changed',
			targetType: 'document',
			targetId: input.documentId,
			summary: `„${ctx.document.title}” ${input.isProtected ? 'védett lett' : 'már nem védett'}`
		});
	});
}
