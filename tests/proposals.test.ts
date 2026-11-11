import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	acceptProposal,
	listRevisions,
	lockSection,
	proposeChange,
	proposeNewSection,
	readSection,
	rejectProposal,
	replaceSection
} from '../src/lib/server/core';
import { proposal, section } from '../src/lib/server/db/schema';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

describe('javaslat mód', () => {
	it('a Claude javasol, ember elfogad: új revízió a Claude nevén, az elfogadás naplózva', async () => {
		const s = await seed(db);
		const p = await proposeChange(db, claude(s.kollega.id), {
			sectionId: s.planSec.sectionId,
			baseRevision: 1,
			content: 'A pályázatfigyelő célja: értesíteni és nyomon követni.',
			reason: 'bővebb cél'
		});
		expect(p.diff).toContain('+A pályázatfigyelő célja: értesíteni és nyomon követni.');
		expect((await readSection(db, human(s.levente.id), s.planSec.sectionId)).openProposals).toHaveLength(1);

		await expectCoreError(acceptProposal(db, claude(s.levente.id), { proposalId: p.proposalId }), 'HUMAN_ONLY');
		const res = await acceptProposal(db, human(s.levente.id), { proposalId: p.proposalId });
		expect(res.revision).toBe(2);

		const read = await readSection(db, human(s.levente.id), s.planSec.sectionId);
		expect(read.content).toContain('nyomon követni');
		expect(read.openProposals).toHaveLength(0);
		const [rev] = await listRevisions(db, human(s.levente.id), s.planSec.sectionId);
		expect(rev).toMatchObject({ revision: 2, kind: 'proposal', by: 'Kollega', via: 'claude' });
		const [row] = await db.select().from(proposal).where(eq(proposal.id, p.proposalId));
		expect(row).toMatchObject({ status: 'accepted', resolvedBy: s.levente.id, appliedRevision: 2 });
	});

	it('ha közben valaki ír a szakaszba, a nyitott javaslat ütközik, és nem fogadható el', async () => {
		const s = await seed(db);
		const p = await proposeChange(db, claude(s.kollega.id), {
			sectionId: s.planSec.sectionId,
			baseRevision: 1,
			content: 'javasolt',
			reason: 'r'
		});
		await replaceSection(db, human(s.levente.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'kézi', reason: 'r' });
		const [row] = await db.select().from(proposal).where(eq(proposal.id, p.proposalId));
		expect(row.status).toBe('conflicted');
		await expectCoreError(acceptProposal(db, human(s.levente.id), { proposalId: p.proposalId }), 'PROPOSAL_NOT_OPEN');
		expect((await readSection(db, human(s.levente.id), s.planSec.sectionId)).content).toBe('kézi');
	});

	it('elavult alapra nem lehet javasolni', async () => {
		const s = await seed(db);
		await replaceSection(db, human(s.levente.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'kézi', reason: 'r' });
		await expectCoreError(
			proposeChange(db, claude(s.kollega.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' }),
			'STALE_REVISION'
		);
	});

	it('más zárja alatt a javaslat nem fogadható el', async () => {
		const s = await seed(db);
		const p = await proposeChange(db, claude(s.kollega.id), {
			sectionId: s.planSec.sectionId,
			baseRevision: 1,
			content: 'x',
			reason: 'r'
		});
		await lockSection(db, human(s.kollega.id), { sectionId: s.planSec.sectionId });
		await expectCoreError(acceptProposal(db, human(s.levente.id), { proposalId: p.proposalId }), 'SECTION_LOCKED');
	});

	it('új szakasz javaslata elfogadáskor a megadott helyre kerül', async () => {
		const s = await seed(db);
		const p = await proposeNewSection(db, claude(s.kollega.id), {
			documentId: s.plan.id,
			afterSectionId: s.planSec.sectionId,
			title: 'Célcsoport',
			content: '100 fő alatti cégek',
			reason: 'hiányzik'
		});
		const res = await acceptProposal(db, human(s.levente.id), { proposalId: p.proposalId });
		const [row] = await db.select().from(section).where(eq(section.id, res.sectionId));
		expect(row).toMatchObject({ title: 'Célcsoport', documentId: s.plan.id, revision: 1 });
		expect(row.position).toBeGreaterThan(s.planSec.position);
	});

	it('elutasítás: a szerző visszavonhatja, más Claude nem utasíthatja el, ember igen', async () => {
		const s = await seed(db);
		const mk = () =>
			proposeChange(db, claude(s.kollega.id), { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' });
		const a = await mk();
		await expectCoreError(rejectProposal(db, claude(s.levente.id), { proposalId: a.proposalId }), 'HUMAN_ONLY');
		expect((await rejectProposal(db, human(s.levente.id), { proposalId: a.proposalId, note: 'nem kell' })).status).toBe('rejected');
		const b = await mk();
		expect((await rejectProposal(db, claude(s.kollega.id), { proposalId: b.proposalId })).status).toBe('rejected');
		await expectCoreError(rejectProposal(db, human(s.levente.id), { proposalId: b.proposalId }), 'PROPOSAL_NOT_OPEN');
	});
});
