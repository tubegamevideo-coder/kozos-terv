import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { document, project } from '../../../../../lib/server/db/schema';
import { humanActor, orError, orFail, str } from '../../../../../lib/server/web';
import { listTrashedSections, setDocumentProtection, updateProjectInstructions } from '../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	const trashed = await orError(listTrashedSections(db, actor, params.projectId)); // jogosultság-ellenőrzés is
	const [p] = await db.select({ instructions: project.instructions }).from(project).where(eq(project.id, params.projectId));
	const docs = await db
		.select({ id: document.id, title: document.title, kind: document.kind, isProtected: document.isProtected })
		.from(document)
		.where(and(eq(document.projectId, params.projectId), isNull(document.deletedAt)))
		.orderBy(asc(document.createdAt));
	return { instructions: p?.instructions ?? '', docs, trashed };
};

export const actions: Actions = {
	instructions: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(updateProjectInstructions(getDb(), actor, { projectId: params.projectId, instructions: str(f, 'instructions') }));
		return r.ok ? { ok: 'Projektutasítás mentve.' } : r.failure;
	},
	protect: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(setDocumentProtection(getDb(), actor, { documentId: str(f, 'documentId'), isProtected: str(f, 'value') === '1' }));
		return r.ok ? { ok: 'Védettség módosítva.' } : r.failure;
	}
};
