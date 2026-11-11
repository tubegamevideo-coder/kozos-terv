import { describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
	CoreError,
	createSection,
	editSection,
	getChanges,
	lockSection,
	readSection,
	replaceSection
} from '../src/lib/server/core';
import { sectionRevision } from '../src/lib/server/db/schema';
import { claude, human, seed, useDb } from './helpers';

const { db } = useDb();

const codes = (results: PromiseSettledResult<unknown>[]) =>
	results.map((r) => (r.status === 'fulfilled' ? 'OK' : r.reason instanceof CoreError ? r.reason.code : String(r.reason)));

describe('párhuzamos írás', () => {
	it('ugyanarra a revízióra 12 egyidejű írásból pontosan egy nyer, a többi STALE_REVISION', async () => {
		const s = await seed(db);
		const actors = [claude(s.levente.id), claude(s.kollega.id), human(s.levente.id)];
		const results = await Promise.allSettled(
			Array.from({ length: 12 }, (_, i) =>
				replaceSection(db, actors[i % 3], {
					sectionId: s.noteSec.sectionId,
					baseRevision: 1,
					content: `Változat ${i}`,
					reason: `író ${i}`
				})
			)
		);
		const c = codes(results);
		expect(c.filter((x) => x === 'OK')).toHaveLength(1);
		expect(c.filter((x) => x === 'STALE_REVISION')).toHaveLength(11);
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(read.revision).toBe(2);
		const revs = await db
			.select({ revision: sectionRevision.revision })
			.from(sectionRevision)
			.where(eq(sectionRevision.sectionId, s.noteSec.sectionId))
			.orderBy(asc(sectionRevision.revision));
		expect(revs.map((r) => r.revision)).toEqual([1, 2]);
	});

	it('láncolt, egymásra épülő írások mind átmennek, semmi nem vész el', async () => {
		const s = await seed(db);
		// Két Claude felváltva ír; mindegyik a másik friss revíziójára épít (újraolvasás után).
		const writers = [claude(s.levente.id), claude(s.kollega.id)];
		for (const [i, word] of ['alfa', 'béta', 'gamma', 'delta'].entries()) {
			const current = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
			await editSection(db, writers[i % 2], {
				sectionId: s.noteSec.sectionId,
				baseRevision: current.revision,
				oldText: 'Harmadik sor.',
				newText: `Harmadik sor.\n${word}`,
				reason: word
			});
		}
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(read.content.split('\n').slice(-4)).toEqual(['delta', 'gamma', 'béta', 'alfa']);
		expect(read.revision).toBe(5);
	});

	it('két Claude egyszerre foglal: pontosan egy kapja meg a zárat', async () => {
		const s = await seed(db);
		const results = await Promise.allSettled(
			Array.from({ length: 8 }, (_, i) =>
				lockSection(db, claude(i % 2 ? s.levente.id : s.kollega.id), { sectionId: s.noteSec.sectionId, purpose: `#${i}` })
			)
		);
		const winners = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ extended: boolean }>[];
		const firstAcquires = winners.filter((w) => !w.value.extended);
		expect(firstAcquires).toHaveLength(1);
		// a győztes további hívásai hosszabbítások, a vesztes oldal mind SECTION_LOCKED
		const c = codes(results);
		expect(c.every((x) => x === 'OK' || x === 'SECTION_LOCKED')).toBe(true);
		const read = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		const holderIsLevente = read.lock?.heldBy === 'Levente';
		results.forEach((r, i) => {
			const mine = i % 2 ? holderIsLevente : !holderIsLevente;
			expect(r.status === 'fulfilled').toBe(mine);
		});
	});

	it('párhuzamos szakaszbeszúrás ugyanoda: mind létrejön, különböző pozícióval', async () => {
		const s = await seed(db);
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, i) =>
				createSection(db, claude(i % 2 ? s.levente.id : s.kollega.id), {
					documentId: s.note.id,
					title: `Új ${i}`,
					afterSectionId: s.noteSec.sectionId,
					reason: 'r'
				})
			)
		);
		const positions = new Set(results.map((r) => r.position));
		expect(positions.size).toBe(6);
	});

	it('az eseménynapló kurzora párhuzamos írásnál sem ugrik át eseményt', async () => {
		const s = await seed(db);
		const extra = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				createSection(db, human(s.levente.id), { documentId: s.note.id, title: `S${i}`, reason: 'r' })
			)
		);
		await Promise.allSettled(
			extra.flatMap((x, i) => [
				replaceSection(db, claude(s.kollega.id), { sectionId: x.sectionId, baseRevision: 1, content: `a${i}`, reason: 'r' }),
				replaceSection(db, claude(s.levente.id), { sectionId: x.sectionId, baseRevision: 1, content: `b${i}`, reason: 'r' })
			])
		);
		const all = await getChanges(db, human(s.levente.id), { projectId: s.project.id, limit: 500 });
		const ids = all.items.map((e) => e.id);
		expect(ids).toEqual([...ids].sort((a, b) => a - b));
		expect(new Set(ids).size).toBe(ids.length);
		expect(all.items.filter((e) => e.type === 'section.replaced')).toHaveLength(5);
	});
});
