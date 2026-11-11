import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { document, project, section, workspaceMember } from '../db/schema';
import { CoreError } from './errors';
import type { Actor, Role } from './types';

const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export async function getRole(db: DbOrTx, userId: string, workspaceId: string): Promise<Role | null> {
	const [m] = await db
		.select({ role: workspaceMember.role })
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)));
	return m?.role ?? null;
}

export async function requireRole(
	db: DbOrTx,
	actor: Actor,
	workspaceId: string,
	min: Role
): Promise<Role> {
	const role = await getRole(db, actor.userId, workspaceId);
	if (!role) {
		// Nem tag: ne áruljuk el, hogy létezik.
		throw new CoreError('NOT_FOUND', 'Nincs ilyen elem, vagy nincs hozzá hozzáférésed.');
	}
	if (rank[role] < rank[min]) {
		throw new CoreError('FORBIDDEN', `Ehhez legalább „${min}” szerepkör kell, neked „${role}” van.`, {
			role,
			required: min
		});
	}
	return role;
}

export async function loadProject(db: DbOrTx, actor: Actor, projectId: string, min: Role) {
	const [p] = await db
		.select()
		.from(project)
		.where(and(eq(project.id, projectId), isNull(project.deletedAt)));
	if (!p) throw new CoreError('NOT_FOUND', 'Nincs ilyen projekt.', { projectId });
	const role = await requireRole(db, actor, p.workspaceId, min);
	return { project: p, role };
}

export async function loadDocument(db: DbOrTx, actor: Actor, documentId: string, min: Role) {
	const [row] = await db
		.select({ document, project })
		.from(document)
		.innerJoin(project, eq(project.id, document.projectId))
		.where(and(eq(document.id, documentId), isNull(project.deletedAt)));
	if (!row) throw new CoreError('NOT_FOUND', 'Nincs ilyen dokumentum.', { documentId });
	const role = await requireRole(db, actor, row.project.workspaceId, min);
	if (row.document.deletedAt && min !== 'viewer') {
		throw new CoreError('IN_TRASH', 'A dokumentum a lomtárban van.', { documentId });
	}
	return { ...row, role };
}

/**
 * Betölti a szakaszt a dokumentumával és projektjével. `forUpdate` esetén a szakasz sorát
 * zárolja a tranzakció végéig: ettől lesznek sorba rendezve az ugyanarra a szakaszra érkező írások.
 */
export async function loadSection(
	db: DbOrTx,
	actor: Actor,
	sectionId: string,
	min: Role,
	opts: { forUpdate?: boolean } = {}
) {
	const q = db
		.select({ section, document, project })
		.from(section)
		.innerJoin(document, eq(document.id, section.documentId))
		.innerJoin(project, eq(project.id, document.projectId))
		.where(and(eq(section.id, sectionId), isNull(project.deletedAt)));
	const [row] = opts.forUpdate ? await q.for('update', { of: section }) : await q;
	if (!row) throw new CoreError('NOT_FOUND', 'Nincs ilyen szakasz.', { sectionId });
	const role = await requireRole(db, actor, row.project.workspaceId, min);
	return { ...row, role };
}
