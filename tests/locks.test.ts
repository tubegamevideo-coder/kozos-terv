import { describe, expect, it } from 'vitest';
import { clock, editSection, lockSection, readSection, releaseSection, replaceSection } from '../src/lib/server/core';
import { claude, expectCoreError, human, minutesFromNow, seed, useDb } from './helpers';

const { db } = useDb();

describe('szakaszzár', () => {
	it('amíg más tartja, az írás SECTION_LOCKED, a válaszban ki és meddig', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, purpose: 'átírom a teljes szakaszt' });
		const err = await expectCoreError(
			replaceSection(db, claude(s.kollega.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' }),
			'SECTION_LOCKED'
		);
		expect(err.details).toMatchObject({ heldBy: 'Levente', via: 'claude', purpose: 'átírom a teljes szakaszt' });
		expect(typeof err.details.expiresAt).toBe('string');
	});

	it('a zártartó írhat – a Claude-ján át és a felületről is', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId });
		const a = await replaceSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'a', reason: 'r' });
		const b = await replaceSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 2, content: 'b', reason: 'r' });
		expect([a.revision, b.revision]).toEqual([2, 3]);
	});

	it('a zár magától lejár (alapból 20 perc), utána más is írhat', async () => {
		const s = await seed(db);
		const l = await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId });
		expect(l.expiresAt.getTime() - Date.now()).toBeGreaterThan(19 * 60_000);
		clock.now = minutesFromNow(19);
		await expectCoreError(
			replaceSection(db, human(s.kollega.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' }),
			'SECTION_LOCKED'
		);
		clock.now = minutesFromNow(21);
		const res = await replaceSection(db, human(s.kollega.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' });
		expect(res.revision).toBe(2);
		expect((await readSection(db, human(s.kollega.id), s.noteSec.sectionId)).lock).toBeNull();
	});

	it('más élő zárját nem lehet felülírni, a sajátot meg lehet hosszabbítani', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, minutes: 5 });
		await expectCoreError(lockSection(db, claude(s.kollega.id), { sectionId: s.noteSec.sectionId }), 'SECTION_LOCKED');
		const ext = await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, minutes: 60 });
		expect(ext.extended).toBe(true);
		expect(ext.expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
		await expectCoreError(lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, minutes: 500 }), 'VALIDATION');
	});

	it('megjegyzésnél kisebb írás: a zár a revízióval együtt véd (lejárt zár után is kell friss revízió)', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, minutes: 1 });
		await replaceSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'L', reason: 'r' });
		clock.now = minutesFromNow(2);
		await expectCoreError(
			editSection(db, claude(s.kollega.id), {
				sectionId: s.noteSec.sectionId,
				baseRevision: 1,
				oldText: 'Első',
				newText: 'x',
				reason: 'r'
			}),
			'STALE_REVISION'
		);
	});

	it('más zárját csak a tulajdonos ember oldhatja fel, kényszerrel', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.kollega.id), { sectionId: s.noteSec.sectionId });
		await expectCoreError(releaseSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId }), 'SECTION_LOCKED');
		await expectCoreError(
			releaseSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId, force: true }),
			'FORBIDDEN'
		);
		const r = await releaseSection(db, human(s.levente.id), { sectionId: s.noteSec.sectionId, force: true });
		expect(r.released).toBe(true);
		expect((await readSection(db, human(s.levente.id), s.noteSec.sectionId)).lock).toBeNull();
	});

	it('szerkesztő nem oldhatja fel más zárját kényszerrel sem', async () => {
		const s = await seed(db);
		await lockSection(db, claude(s.levente.id), { sectionId: s.noteSec.sectionId });
		await expectCoreError(
			releaseSection(db, human(s.kollega.id), { sectionId: s.noteSec.sectionId, force: true }),
			'FORBIDDEN'
		);
	});

	it('olvasó nem foglalhat', async () => {
		const s = await seed(db);
		await expectCoreError(lockSection(db, claude(s.vendeg.id), { sectionId: s.noteSec.sectionId }), 'FORBIDDEN');
	});
});
