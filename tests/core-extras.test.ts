import { describe, expect, it } from 'vitest';
import {
	addComment,
	addIdea,
	addQuestion,
	getProjectBrief,
	importMarkdown,
	listComments,
	listIdeas,
	listProjects,
	listQuestions,
	lockSection,
	logDecision,
	proposeChange,
	readDocument,
	replaceSection,
	resolveComment,
	searchProject,
	splitMarkdown,
	updateQuestion,
	voteIdea
} from '../src/lib/server/core';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

describe('kérdések és döntésnapló', () => {
	it('kérdés → vitatott → döntés a naplóba, a kérdés eldől', async () => {
		const s = await seed(db);
		const q = await addQuestion(db, claude(s.kollega.id), { projectId: s.project.id, title: 'Milyen adatforrásból?' });
		await updateQuestion(db, claude(s.levente.id), { questionId: q.id, status: 'disputed' });
		await expectCoreError(updateQuestion(db, human(s.levente.id), { questionId: q.id, status: 'decided' }), 'VALIDATION');

		const d = await logDecision(db, claude(s.levente.id), {
			projectId: s.project.id,
			title: 'Adatforrás',
			decision: 'palyazat.gov.hu RSS + kézi felvitel',
			rationale: 'nincs nyilvános API',
			questionId: q.id
		});
		const [after] = await listQuestions(db, human(s.levente.id), { projectId: s.project.id });
		expect(after).toMatchObject({ status: 'decided', decision: 'palyazat.gov.hu RSS + kézi felvitel' });

		const log = await readDocument(db, human(s.levente.id), { documentId: d.documentId, full: true });
		expect(log.kind).toBe('decision_log');
		expect(log.sections[0].content).toContain('**Indoklás:** nincs nyilvános API');
		expect(log.sections[0].content).toContain('Claude-on keresztül');

		// a második döntés ugyanabba a naplóba kerül
		const d2 = await logDecision(db, human(s.kollega.id), { projectId: s.project.id, title: 'Név', decision: 'Pályázatfigyelő' });
		expect(d2.documentId).toBe(d.documentId);
	});

	it('olvasó nem vehet fel kérdést', async () => {
		const s = await seed(db);
		await expectCoreError(addQuestion(db, claude(s.vendeg.id), { projectId: s.project.id, title: 'x' }), 'FORBIDDEN');
	});
});

describe('megjegyzések', () => {
	it('zárolt és védett szakaszra is lehet, olvasóként is; szálakba rendeződik', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.planSec.sectionId });
		const root = await addComment(db, claude(s.kollega.id), { sectionId: s.planSec.sectionId, body: 'Ez így túl rövid.' });
		await addComment(db, human(s.vendeg.id), { sectionId: s.planSec.sectionId, body: 'Egyetértek.', parentId: root.id });
		const threads = await listComments(db, human(s.levente.id), { sectionId: s.planSec.sectionId });
		expect(threads).toHaveLength(1);
		expect(threads[0]).toMatchObject({ body: 'Ez így túl rövid.', by: 'Kollega', via: 'claude' });
		expect(threads[0].replies.map((r) => r.by)).toEqual(['Vendeg']);

		await resolveComment(db, human(s.levente.id), { commentId: root.id });
		expect(await listComments(db, human(s.levente.id), { sectionId: s.planSec.sectionId })).toHaveLength(0);
		expect(await listComments(db, human(s.levente.id), { sectionId: s.planSec.sectionId, includeResolved: true })).toHaveLength(1);
	});

	it('pontosan egy cél kell, és nem tag nem kommentelhet', async () => {
		const s = await seed(db);
		await expectCoreError(addComment(db, human(s.levente.id), { body: 'x' }), 'VALIDATION');
		await expectCoreError(addComment(db, human(s.idegen.id), { sectionId: s.noteSec.sectionId, body: 'x' }), 'NOT_FOUND');
	});
});

describe('ötletek', () => {
	it('szavazás felhasználónként egyszer számít, a lista szavazat szerint rendez', async () => {
		const s = await seed(db);
		const a = await addIdea(db, claude(s.kollega.id), { projectId: s.project.id, title: 'E-mail értesítő', tags: ['Értesítés', ' értesítés '] });
		const b = await addIdea(db, claude(s.levente.id), { projectId: s.project.id, title: 'Határidő-naptár' });
		expect(a.tags).toEqual(['értesítés']);
		await voteIdea(db, claude(s.levente.id), { ideaId: b.id, value: 1 });
		await voteIdea(db, human(s.levente.id), { ideaId: b.id, value: 1 });
		const r = await voteIdea(db, claude(s.kollega.id), { ideaId: b.id, value: 1 });
		expect(r.votes).toBe(2);
		const list = await listIdeas(db, claude(s.levente.id), { projectId: s.project.id });
		expect(list.map((i) => [i.title, i.votes, i.myVote])).toEqual([
			['Határidő-naptár', 2, 1],
			['E-mail értesítő', 0, 0]
		]);
		expect(await listIdeas(db, claude(s.levente.id), { projectId: s.project.id, tag: 'értesítés' })).toHaveLength(1);
	});
});

describe('olvasás és összefoglaló', () => {
	it('readDocument alapból vázlatot ad, kérésre teljes szöveget', async () => {
		const s = await seed(db);
		const outline = await readDocument(db, claude(s.kollega.id), { documentId: s.note.id });
		expect(outline.sections[0]).toMatchObject({ title: 'Ötletek', revision: 1, summary: 'Első sor.' });
		expect(outline.sections[0]).not.toHaveProperty('content');
		const full = await readDocument(db, claude(s.kollega.id), { documentId: s.note.id, full: true });
		expect(full.sections[0].content).toContain('Harmadik sor.');
	});

	it('a projekt-összefoglaló mindent egy hívásban ad, és csak az újakat mutatja másodszorra', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, purpose: 'bővítem' });
		await proposeChange(db, claude(s.levente.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'x', reason: 'jobb' });
		await addQuestion(db, human(s.levente.id), { projectId: s.project.id, title: 'Ki a célcsoport?' });

		const brief = await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		expect(brief.project).toMatchObject({ name: 'Pályázatfigyelő', yourRole: 'editor' });
		expect(brief.documents.map((d) => d.title)).toEqual(['Jegyzetek', 'Fő terv']);
		expect(brief.documents[0].sections[0]).toMatchObject({ title: 'Ötletek', lock: { heldBy: 'Levente', purpose: 'bővítem' } });
		expect(brief.activeLocks).toHaveLength(1);
		expect(brief.openProposals).toMatchObject([{ sectionTitle: 'Cél', by: 'Levente', via: 'claude' }]);
		expect(brief.openQuestions.map((q) => q.title)).toEqual(['Ki a célcsoport?']);
		expect(brief.changesSinceLastVisit.items.length).toBeGreaterThan(3);
		expect(brief.otherMembers.map((m) => m.name).sort()).toEqual(['Levente', 'Vendeg']);

		const again = await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		expect(again.changesSinceLastVisit.items).toHaveLength(0);
		await replaceSection(db, human(s.levente.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'y', reason: 'kézi' });
		const third = await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		expect(third.changesSinceLastVisit.items.map((e) => e.type)).toEqual(['section.replaced']);
		expect(third.openProposals).toHaveLength(0); // a javaslat közben ütközött
	});

	it('listProjects az olvasatlan változásokat is számolja', async () => {
		const s = await seed(db);
		const [p] = await listProjects(db, claude(s.kollega.id));
		expect(p).toMatchObject({ name: 'Pályázatfigyelő', role: 'editor', workspace: 'Fabak' });
		expect(p.unseenChanges).toBeGreaterThan(0);
		await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		const [p2] = await listProjects(db, claude(s.kollega.id));
		expect(p2.unseenChanges).toBe(0);
		expect(await listProjects(db, claude(s.idegen.id))).toHaveLength(0);
	});
});

describe('keresés', () => {
	it('szótövezve talál a szakaszokban, kiemelt részlettel; kérdésekben és ötletekben is', async () => {
		const s = await seed(db);
		await replaceSection(db, human(s.levente.id), {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			content: 'A pályázatok határidejéről e-mailben értesítjük a felhasználókat.',
			reason: 'r'
		});
		await addQuestion(db, human(s.levente.id), { projectId: s.project.id, title: 'Kell-e határidő-emlékeztető?' });
		// „pályázatokról” → „pályázat” tő, megtalálja a „pályázatok” szót
		const r = await searchProject(db, claude(s.kollega.id), { projectId: s.project.id, query: 'pályázatokról' });
		expect(r.sections.map((x) => x.title)).toContain('Ötletek');
		expect(r.sections.find((x) => x.title === 'Ötletek')!.snippet).toContain('«pályázatok»');
		const q = await searchProject(db, claude(s.kollega.id), { projectId: s.project.id, query: 'határidő' });
		expect(q.questions.map((x) => x.title)).toEqual(['Kell-e határidő-emlékeztető?']);
		await expectCoreError(searchProject(db, claude(s.idegen.id), { projectId: s.project.id, query: 'x' }), 'NOT_FOUND');
	});
});

describe('Markdown-import', () => {
	it('## címeknél bont, a kódblokkban lévő # sort nem veszi címnek', () => {
		const md = '# Terv\n\nBevezető szöveg.\n\n## Cél\n\nEgy.\n\n```bash\n## nem cím\n```\n\n## Stack\n\nKettő.\n';
		const r = splitMarkdown(md);
		expect(r.title).toBe('Terv');
		expect(r.sections.map((x) => x.title)).toEqual(['Bevezetés', 'Cél', 'Stack']);
		expect(r.sections[1].content).toContain('## nem cím');
	});

	it('importál, a fő terv védett lesz; Claude nem importálhat', async () => {
		const s = await seed(db);
		const r = await importMarkdown(db, human(s.levente.id), {
			projectId: s.project.id,
			markdown: '# Spec\n\n## A\n\nelső\n\n## B\n\nmásodik',
			kind: 'main_plan'
		});
		const doc = await readDocument(db, human(s.levente.id), { documentId: r.documentId });
		expect(doc).toMatchObject({ title: 'Spec', isProtected: true });
		expect(doc.sections.map((x) => x.title)).toEqual(['A', 'B']);
		await expectCoreError(importMarkdown(db, claude(s.levente.id), { projectId: s.project.id, markdown: '## x' }), 'HUMAN_ONLY');
	});
});

describe('projekt adatai', () => {
	it('ember átnevezheti, a Claude nem; az esemény naplózva', async () => {
		const { updateProjectInfo, getChanges } = await import('../src/lib/server/core');
		const s = await seed(db);
		await expectCoreError(updateProjectInfo(db, claude(s.levente.id), { projectId: s.project.id, name: 'X', goal: '' }), 'HUMAN_ONLY');
		await expectCoreError(updateProjectInfo(db, human(s.vendeg.id), { projectId: s.project.id, name: 'X', goal: '' }), 'FORBIDDEN');
		await updateProjectInfo(db, human(s.kollega.id), { projectId: s.project.id, name: 'Teréz', goal: 'Közös tervezés' });
		const [p] = await listProjects(db, human(s.levente.id));
		expect(p).toMatchObject({ name: 'Teréz', goal: 'Közös tervezés' });
		const ch = await getChanges(db, human(s.levente.id), { projectId: s.project.id, limit: 200 });
		expect(ch.items.at(-1)?.summary).toContain('új neve: „Teréz”');
	});
});
