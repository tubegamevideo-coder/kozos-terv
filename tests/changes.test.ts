import { describe, expect, it } from 'vitest';
import {
	createDocument,
	getChanges,
	getChangesSinceLastVisit,
	markVisit,
	replaceSection
} from '../src/lib/server/core';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

describe('változások az utolsó látogatás óta', () => {
	it('csak a mások változásait adja vissza, és a látogatás után nullázódik', async () => {
		const s = await seed(db);
		await markVisit(db, claude(s.kollega.id), { projectId: s.project.id, channel: 'mcp' });

		await replaceSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'L', reason: 'Levente írta' });
		await replaceSection(db, claude(s.kollega.id), { sectionId: s.noteSec.sectionId, baseRevision: 2, content: 'K', reason: 'saját' });

		const news = await getChangesSinceLastVisit(db, claude(s.kollega.id), { projectId: s.project.id, channel: 'mcp' });
		expect(news.items.map((e) => [e.type, e.by, e.via])).toEqual([['section.replaced', 'Levente', 'claude']]);

		await markVisit(db, claude(s.kollega.id), { projectId: s.project.id, channel: 'mcp', upToEventId: news.nextCursor });
		const after = await getChangesSinceLastVisit(db, claude(s.kollega.id), { projectId: s.project.id, channel: 'mcp' });
		expect(after.items).toHaveLength(0);

		// a webes csatorna külön számol
		const web = await getChangesSinceLastVisit(db, human(s.kollega.id), { projectId: s.project.id, channel: 'web' });
		expect(web.items.length).toBeGreaterThan(1);
	});

	it('a kurzor sosem megy vissza, és a lapozás működik', async () => {
		const s = await seed(db);
		const { lastEventId } = await markVisit(db, human(s.levente.id), { projectId: s.project.id, channel: 'web' });
		const back = await markVisit(db, human(s.levente.id), { projectId: s.project.id, channel: 'web', upToEventId: 1 });
		expect(back.lastEventId).toBe(lastEventId);

		for (let i = 0; i < 4; i++) {
			await createDocument(db, claude(s.kollega.id), { projectId: s.project.id, title: `D${i}` });
		}
		const p1 = await getChanges(db, human(s.levente.id), { projectId: s.project.id, afterEventId: lastEventId, limit: 3 });
		expect(p1.items).toHaveLength(3);
		expect(p1.hasMore).toBe(true);
		const p2 = await getChanges(db, human(s.levente.id), { projectId: s.project.id, afterEventId: p1.nextCursor, limit: 3 });
		expect(p2.items).toHaveLength(1);
		expect(p2.hasMore).toBe(false);
	});

	it('nem tag nem látja a projekt eseményeit', async () => {
		const s = await seed(db);
		await expectCoreError(getChanges(db, human(s.idegen.id), { projectId: s.project.id }), 'NOT_FOUND');
	});

	it('fő tervet a Claude csak védettként hozhat létre', async () => {
		const s = await seed(db);
		await expectCoreError(
			createDocument(db, claude(s.kollega.id), { projectId: s.project.id, title: 'X', kind: 'main_plan', isProtected: false }),
			'PROTECTED_DOCUMENT'
		);
		const d = await createDocument(db, claude(s.kollega.id), { projectId: s.project.id, title: 'Y', kind: 'main_plan' });
		expect(d.isProtected).toBe(true);
	});
});
