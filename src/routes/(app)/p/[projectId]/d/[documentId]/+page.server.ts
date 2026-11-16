import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../../../../lib/server/db/client';
import { humanActor, int, orError, orFail, str } from '../../../../../../lib/server/web';
import { renderMarkdown } from '../../../../../../lib/server/markdown';
import {
	addComment,
	createSection,
	linkRepoFile,
	listComments,
	listProjectRepos,
	readDocument,
	refreshRepoSection,
	refreshStaleRepoSections,
	releaseSection,
	replaceSection,
	resolveComment,
	trashSection
} from '../../../../../../lib/server/core';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const db = getDb();
	// A repóból hivatkozott szakaszokat a háttérben frissítjük, ha régi a legutóbbi ellenőrzésük: az oldal
	// nem vár a GitHubra, és ha új változat jön, az élő frissítés (section.synced esemény) megmutatja.
	refreshStaleRepoSections(db, actor, { documentId: params.documentId }).catch((e) => console.error('[repo] háttérfrissítés', e));
	const doc = await orError(readDocument(db, actor, { documentId: params.documentId, full: true }));
	if (doc.projectId !== params.projectId) redirect(303, `/p/${doc.projectId}/d/${doc.id}`);
	const [sections, repos] = await Promise.all([
		Promise.all(
			doc.sections.map(async (s) => ({
				...s,
				html: renderMarkdown(s.content ?? ''),
				comments: await listComments(db, actor, { sectionId: s.id })
			}))
		),
		listProjectRepos(db, actor, doc.projectId)
	]);
	return {
		doc: { ...doc, sections },
		repos: repos.map((r) => ({ id: r.id, provider: r.provider, repo: r.repo })),
		editId: url.searchParams.get('edit'),
		newAfter: url.searchParams.get('uj')
	};
};

const back = (params: { projectId: string; documentId: string }, sectionId?: string) =>
	`/p/${params.projectId}/d/${params.documentId}${sectionId ? `#s-${sectionId}` : ''}`;

export const actions: Actions = {
	save: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const sectionId = str(f, 'sectionId');
		const r = await orFail(
			replaceSection(getDb(), actor, {
				sectionId,
				baseRevision: int(f, 'baseRevision'),
				title: str(f, 'title'),
				content: str(f, 'content'),
				reason: str(f, 'reason') || 'kézi szerkesztés'
			})
		);
		if (!r.ok) {
			// A piszkozatot visszaadjuk, hogy ne vesszen el.
			const data = r.failure.data as Record<string, unknown>;
			return fail(400, { ...data, sectionId, draft: { title: str(f, 'title'), content: str(f, 'content'), reason: str(f, 'reason') } });
		}
		redirect(303, back(params, sectionId));
	},
	create: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(
			createSection(getDb(), actor, {
				documentId: params.documentId,
				title: str(f, 'title'),
				content: str(f, 'content'),
				afterSectionId: str(f, 'afterSectionId') || null,
				reason: str(f, 'reason') || 'új szakasz'
			})
		);
		if (!r.ok) return r.failure;
		redirect(303, back(params, r.value.sectionId));
	},
	link: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		// A repó a listából jön („github:tulajdonos/név”); az útvonal helyére a fájl webes címe is beilleszthető.
		const target = str(f, 'path').trim();
		const picked = str(f, 'repo');
		const sep = picked.indexOf(':');
		const isUrl = /^https?:\/\//i.test(target);
		const r = await orFail(
			linkRepoFile(getDb(), actor, {
				documentId: params.documentId,
				repo: isUrl ? target : picked.slice(sep + 1),
				provider: isUrl ? undefined : picked.slice(0, sep) === 'gitlab' ? 'gitlab' : 'github',
				path: isUrl ? undefined : target,
				ref: str(f, 'ref').trim() || undefined,
				title: str(f, 'title').trim() || undefined,
				afterSectionId: str(f, 'afterSectionId') || null,
				reason: str(f, 'reason') || 'szakasz a repóból'
			})
		);
		if (!r.ok) return r.failure;
		redirect(303, back(params, r.value.sectionId));
	},
	refresh: async ({ locals, url, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(refreshRepoSection(getDb(), actor, { sectionId: str(f, 'sectionId') }));
		if (!r.ok) return r.failure;
		return { ok: r.value.changed ? 'Frissítve: új változat jött a repóból.' : 'Naprakész: a repóban nincs változás.' };
	},
	comment: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const sectionId = str(f, 'sectionId');
		const r = await orFail(addComment(getDb(), actor, { sectionId, body: str(f, 'body'), parentId: str(f, 'parentId') || undefined }));
		if (!r.ok) return r.failure;
		redirect(303, back(params, sectionId));
	},
	resolveComment: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(resolveComment(getDb(), actor, { commentId: str(f, 'commentId') }));
		if (!r.ok) return r.failure;
		redirect(303, back(params, str(f, 'sectionId')));
	},
	trash: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const r = await orFail(
			trashSection(getDb(), actor, { sectionId: str(f, 'sectionId'), baseRevision: int(f, 'baseRevision'), reason: str(f, 'reason') || 'lomtárba' })
		);
		if (!r.ok) return r.failure;
		redirect(303, back(params));
	},
	unlock: async ({ locals, url, params, request }) => {
		const actor = humanActor(locals, url);
		const f = await request.formData();
		const sectionId = str(f, 'sectionId');
		const r = await orFail(releaseSection(getDb(), actor, { sectionId, force: true }));
		if (!r.ok) return r.failure;
		redirect(303, back(params, sectionId));
	}
};
