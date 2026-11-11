import { describe, expect, it } from 'vitest';
import {
	compareRevisions,
	listProposals,
	listTrashedSections,
	proposeChange,
	proposeNewSection,
	replaceSection,
	trashSection
} from '../src/lib/server/core';
import { renderMarkdown } from '../src/lib/server/markdown';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

describe('javaslatok a felülethez', () => {
	it('diff az alapváltozathoz képest; elavult javaslat jelölve; új szakasz az üreshez képest', async () => {
		const s = await seed(db);
		await proposeChange(db, claude(s.kollega.id), { sectionId: s.planSec.sectionId, baseRevision: 1, title: 'Cél (új)', content: 'A pályázatfigyelő célja: értesíteni.\nÉs követni.', reason: 'bővítés' });
		await proposeNewSection(db, claude(s.kollega.id), { documentId: s.plan.id, title: 'Kockázatok', content: '- adat', reason: 'hiányzik' });
		const list = await listProposals(db, human(s.levente.id), { projectId: s.project.id });
		expect(list).toHaveLength(2);
		const edit = list.find((p) => !p.newSection)!;
		expect(edit).toMatchObject({ titleChanged: true, baseTitle: 'Cél', stale: false, by: 'Kollega', via: 'claude' });
		expect(edit.diff).toEqual([
			{ type: 'ctx', text: 'A pályázatfigyelő célja: értesíteni.' },
			{ type: 'add', text: 'És követni.' }
		]);
		const nw = list.find((p) => p.newSection)!;
		expect(nw.diff.every((l) => l.type === 'add')).toBe(true);

		await replaceSection(db, human(s.levente.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'kézi', reason: 'r' });
		const after = await listProposals(db, human(s.levente.id), { projectId: s.project.id });
		expect(after.find((p) => !p.newSection)).toMatchObject({ status: 'conflicted', stale: true, currentRevision: 2 });
		await expectCoreError(listProposals(db, human(s.idegen.id), { projectId: s.project.id }), 'NOT_FOUND');
	});
});

describe('előzmény és lomtár', () => {
	it('két revízió összevetése; lomtárba tett szakasz listázva', async () => {
		const s = await seed(db);
		await replaceSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'Első sor.\nÚj sor.', reason: 'r' });
		const c = await compareRevisions(db, human(s.kollega.id), { sectionId: s.noteSec.sectionId, from: 1, to: 2 });
		expect(c.diff.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['Új sor.']);
		expect(c.diff.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['Második sor.', 'Harmadik sor.']);
		await trashSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 2, reason: 'r' });
		const t = await listTrashedSections(db, human(s.kollega.id), s.project.id);
		expect(t.map((x) => x.title)).toEqual(['Ötletek']);
	});
});

describe('Markdown-megjelenítés', () => {
	it('táblázat és mermaid-blokk marad, szkript és eseménykezelő eltűnik', () => {
		const html = renderMarkdown(
			'| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[l](javascript:alert(1)) [ok](https://x.hu)'
		);
		expect(html).toContain('<table>');
		expect(html).toContain('class="language-mermaid"');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('onerror');
		expect(html).not.toMatch(/href="javascript/i);
		expect(html).toContain('href="https://x.hu"');
		expect(html).toContain('rel="noopener noreferrer"');
	});
});
