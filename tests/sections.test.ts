import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	createSection,
	editSection,
	listRevisions,
	readSection,
	replaceSection,
	restoreRevision,
	trashSection
} from '../src/lib/server/core';
import { section } from '../src/lib/server/db/schema';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

describe('revíziószám', () => {
	it('friss revízióra az írás sikerül, a revízió nő, és rögzül, hogy Claude írta', async () => {
		const s = await seed(db);
		const res = await editSection(db, claude(s.kollega.id), {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			oldText: 'Második sor.',
			newText: 'Második sor, javítva.',
			reason: 'pontosítás'
		});
		expect(res.revision).toBe(2);
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(read.content).toBe('Első sor.\nMásodik sor, javítva.\nHarmadik sor.');
		const revs = await listRevisions(db, human(s.levente.id), s.noteSec.sectionId);
		expect(revs[0]).toMatchObject({ revision: 2, kind: 'edit', by: 'Kollega', via: 'claude', reason: 'pontosítás' });
	});

	it('elavult revízióra STALE_REVISION jön, a friss tartalommal és a különbséggel; semmi nem íródik', async () => {
		const s = await seed(db);
		await editSection(db, human(s.levente.id), {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			oldText: 'Első sor.',
			newText: 'Első sor (Levente).',
			reason: 'saját'
		});
		const err = await expectCoreError(
			replaceSection(db, claude(s.kollega.id), {
				sectionId: s.noteSec.sectionId,
				baseRevision: 1,
				content: 'Teljesen új tartalom',
				reason: 'átírás'
			}),
			'STALE_REVISION'
		);
		expect(err.details).toMatchObject({
			baseRevision: 1,
			currentRevision: 2,
			currentContent: 'Első sor (Levente).\nMásodik sor.\nHarmadik sor.'
		});
		expect(err.details.diff).toContain('-Első sor.');
		expect(err.details.diff).toContain('+Első sor (Levente).');
		expect(err.details.changes).toMatchObject([{ revision: 2, by: 'Levente', via: 'human', reason: 'saját' }]);
		const [row] = await db.select().from(section).where(eq(section.id, s.noteSec.sectionId));
		expect(row.revision).toBe(2);
		expect(row.content).not.toContain('Teljesen új');
	});

	it('nem létező (jövőbeli) revízióra validációs hiba', async () => {
		const s = await seed(db);
		await expectCoreError(
			replaceSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 5, content: 'x', reason: 'r' }),
			'VALIDATION'
		);
	});
});

describe('keresés-csere', () => {
	it('ha a régi szöveg nincs meg: EDIT_NO_MATCH; ha többször van: EDIT_AMBIGUOUS', async () => {
		const s = await seed(db);
		const base = { sectionId: s.noteSec.sectionId, baseRevision: 1, newText: 'x', reason: 'r' };
		await expectCoreError(editSection(db, human(s.levente.id), { ...base, oldText: 'Negyedik' }), 'EDIT_NO_MATCH');
		await expectCoreError(editSection(db, human(s.levente.id), { ...base, oldText: 'sor.' }), 'EDIT_AMBIGUOUS');
	});

	it('a csere szövegében lévő $-jelek nem értelmeződnek mintaként', async () => {
		const s = await seed(db);
		await editSection(db, human(s.levente.id), {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			oldText: 'Első sor.',
			newText: 'Ár: $& és $1',
			reason: 'r'
		});
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(read.content.startsWith('Ár: $& és $1')).toBe(true);
	});

	it('indoklás nélkül nem lehet írni', async () => {
		const s = await seed(db);
		await expectCoreError(
			editSection(db, human(s.levente.id), {
				sectionId: s.noteSec.sectionId,
				baseRevision: 1,
				oldText: 'Első sor.',
				newText: 'x',
				reason: '  '
			}),
			'VALIDATION'
		);
	});
});

describe('jogosultság', () => {
	it('olvasó nem írhat (FORBIDDEN), nem tag nem is látja (NOT_FOUND)', async () => {
		const s = await seed(db);
		const input = { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' };
		await expectCoreError(replaceSection(db, human(s.vendeg.id), input), 'FORBIDDEN');
		await expectCoreError(replaceSection(db, claude(s.idegen.id), input), 'NOT_FOUND');
		await expectCoreError(readSection(db, human(s.idegen.id), s.noteSec.sectionId), 'NOT_FOUND');
		const read = await readSection(db, human(s.vendeg.id), s.noteSec.sectionId);
		expect(read.revision).toBe(1);
	});
});

describe('védett dokumentum', () => {
	it('a Claude nem írhat bele közvetlenül, az ember igen', async () => {
		const s = await seed(db);
		const input = { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'új', reason: 'r' };
		await expectCoreError(replaceSection(db, claude(s.levente.id), input), 'PROTECTED_DOCUMENT');
		await expectCoreError(
			createSection(db, claude(s.levente.id), { documentId: s.plan.id, title: 'Új', reason: 'r' }),
			'PROTECTED_DOCUMENT'
		);
		const res = await replaceSection(db, human(s.levente.id), input);
		expect(res.revision).toBe(2);
	});
});

describe('szakasz létrehozása és lomtár', () => {
	it('afterSectionId-vel a megadott szakasz után kerül', async () => {
		const s = await seed(db);
		const last = await createSection(db, human(s.levente.id), { documentId: s.note.id, title: 'Utolsó', reason: 'r' });
		const mid = await createSection(db, claude(s.kollega.id), {
			documentId: s.note.id,
			title: 'Közép',
			afterSectionId: s.noteSec.sectionId,
			reason: 'r'
		});
		expect(mid.position).toBeGreaterThan(s.noteSec.position);
		expect(mid.position).toBeLessThan(last.position);
	});

	it('lomtárba tett szakaszba nem lehet írni, visszaállítás után igen; a revíziók megmaradnak', async () => {
		const s = await seed(db);
		const t = await trashSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, reason: 'nem kell' });
		expect(t.revision).toBe(2);
		await expectCoreError(
			replaceSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 2, content: 'x', reason: 'r' }),
			'IN_TRASH'
		);
		const r = await restoreRevision(db, human(s.levente.id), {
			sectionId: s.noteSec.sectionId,
			baseRevision: 2,
			toRevision: 1,
			reason: 'mégis kell'
		});
		expect(r.revision).toBe(3);
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(read.inTrash).toBe(false);
		expect(read.content).toBe('Első sor.\nMásodik sor.\nHarmadik sor.');
		const revs = await listRevisions(db, human(s.levente.id), s.noteSec.sectionId);
		expect(revs.map((r) => r.kind)).toEqual(['untrash', 'trash', 'create']);
	});
});
