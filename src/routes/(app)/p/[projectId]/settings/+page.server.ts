import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { document, project } from '../../../../../lib/server/db/schema';
import { humanActor, orError, orFail, str } from '../../../../../lib/server/web';
import {
	addProjectRepo,
	checkRepoAccess,
	generateRepoKey,
	listProjectRepos,
	listTrashedSections,
	removeProjectRepo,
	removeRepoKey,
	setDocumentProtection,
	updateProjectInfo,
	updateProjectInstructions
} from '../../../../../lib/server/core';
import { repoTokens } from '../../../../../lib/server/repo/client';
import { gitlabBase } from '../../../../../lib/server/repo/ref';

/** Ahol a repóban a deploy keyt fel lehet venni (a beállítási oldal linkje). */
const deployKeyUrl = (provider: 'github' | 'gitlab', repo: string) =>
	provider === 'github' ? `https://github.com/${repo}/settings/keys/new` : `${gitlabBase()}/${repo}/-/settings/repository#js-deploy-keys-settings`;

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
	const repos = (await listProjectRepos(db, actor, params.projectId)).map((r) => ({ ...r, deployKeyUrl: deployKeyUrl(r.provider, r.repo) }));
	return { instructions: p?.instructions ?? '', docs, trashed, repos, tokens: repoTokens() };
};

export const actions: Actions = {
	info: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(updateProjectInfo(getDb(), actor, { projectId: params.projectId, name: str(f, 'name'), goal: str(f, 'goal') }));
		return r.ok ? { ok: 'Projekt mentve.' } : r.failure;
	},
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
	},
	addRepo: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const provider = str(f, 'provider') === 'gitlab' ? 'gitlab' : 'github';
		const r = await orFail(addProjectRepo(getDb(), actor, { projectId: params.projectId, repo: str(f, 'repo'), provider }));
		if (!r.ok) return r.failure;
		return { ok: r.value.added ? `Hivatkozható: ${r.value.repo}` : `A(z) ${r.value.repo} már a listában van.` };
	},
	removeRepo: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(removeProjectRepo(getDb(), actor, { projectId: params.projectId, repoId: str(f, 'repoId') }));
		return r.ok ? { ok: 'A repó kikerült a listából; a hivatkozott szakaszok megmaradnak, de nem frissülnek.' } : r.failure;
	},
	genKey: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(generateRepoKey(getDb(), actor, { projectId: params.projectId, repoId: str(f, 'repoId') }));
		if (!r.ok) return r.failure;
		return {
			ok: r.value.replaced
				? 'Új SSH-kulcs kész. A régit töröld a repó Deploy keys részéből, az újat add hozzá, majd ellenőrizd.'
				: 'SSH-kulcs kész. Add hozzá a nyilvános kulcsot a repó Deploy keys részéhez, majd ellenőrizd.'
		};
	},
	checkKey: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(checkRepoAccess(getDb(), actor, { projectId: params.projectId, repoId: str(f, 'repoId') }));
		return r.ok ? { ok: `Rendben: Teréz olvassa a(z) ${r.value.repo} repót (alapértelmezett ág: ${r.value.defaultBranch}).` } : r.failure;
	},
	removeKey: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(removeRepoKey(getDb(), actor, { projectId: params.projectId, repoId: str(f, 'repoId') }));
		return r.ok ? { ok: 'SSH-kulcs törölve. A repó Deploy keys részéből is töröld.' } : r.failure;
	}
};
