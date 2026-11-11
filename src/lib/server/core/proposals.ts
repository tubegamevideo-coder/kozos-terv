import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { document, proposal, section } from '../db/schema';
import { loadDocument, loadSection, requireRole } from './access';
import { unifiedDiff } from './diff';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { assertNotLockedByOther } from './locks';
import { assertFreshRevision, createSectionTx, writeRevision } from './sections';
import { clock, type Actor } from './types';

const need = (s: string | undefined, what: string) => {
	const v = s?.trim();
	if (!v) throw new CoreError('VALIDATION', `Hiányzik: ${what}.`);
	return v;
};

export interface ProposeChangeInput {
	sectionId: string;
	baseRevision: number;
	title?: string;
	content: string;
	reason: string;
}

/** Javaslat egy meglévő szakasz új tartalmára (védett dokumentumokhoz, de bárhol használható). */
export async function proposeChange(db: Db, actor: Actor, input: ProposeChangeInput) {
	const reason = need(input.reason, 'indoklás (reason)');
	return db.transaction(async (tx) => {
		const ctx = await loadSection(tx, actor, input.sectionId, 'editor', { forUpdate: true });
		if (ctx.section.deletedAt) throw new CoreError('IN_TRASH', 'A szakasz a lomtárban van.');
		await assertFreshRevision(tx, ctx, input.baseRevision);
		const title = input.title?.trim() || ctx.section.title;
		const [p] = await tx
			.insert(proposal)
			.values({
				documentId: ctx.document.id,
				sectionId: ctx.section.id,
				baseRevision: input.baseRevision,
				proposedTitle: title,
				proposedContent: input.content,
				reason,
				authorId: actor.userId,
				actorKind: actor.kind
			})
			.returning({ id: proposal.id });
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'proposal.created',
			targetType: 'proposal',
			targetId: p.id,
			summary: `Javaslat: „${ctx.section.title}” – ${reason}`,
			data: { sectionId: ctx.section.id, documentId: ctx.document.id, baseRevision: input.baseRevision }
		});
		return {
			proposalId: p.id,
			diff: unifiedDiff(ctx.section.content, input.content, `rev ${input.baseRevision}`, 'javaslat')
		};
	});
}

export interface ProposeNewSectionInput {
	documentId: string;
	afterSectionId?: string | null;
	title: string;
	content: string;
	reason: string;
}

export async function proposeNewSection(db: Db, actor: Actor, input: ProposeNewSectionInput) {
	const reason = need(input.reason, 'indoklás (reason)');
	const title = need(input.title, 'cím');
	return db.transaction(async (tx) => {
		const ctx = await loadDocument(tx, actor, input.documentId, 'editor');
		const [p] = await tx
			.insert(proposal)
			.values({
				documentId: ctx.document.id,
				afterSectionId: input.afterSectionId ?? null,
				proposedTitle: title,
				proposedContent: input.content,
				reason,
				authorId: actor.userId,
				actorKind: actor.kind
			})
			.returning({ id: proposal.id });
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'proposal.created',
			targetType: 'proposal',
			targetId: p.id,
			summary: `Javaslat új szakaszra: „${title}” (${ctx.document.title}) – ${reason}`,
			data: { documentId: ctx.document.id, newSection: true }
		});
		return { proposalId: p.id };
	});
}

async function getProposal(db: Db, id: string) {
	const [p] = await db.select().from(proposal).where(eq(proposal.id, id));
	if (!p) throw new CoreError('NOT_FOUND', 'Nincs ilyen javaslat.', { proposalId: id });
	return p;
}

/**
 * Ember elfogadja a javaslatot. Ha az alaprevízió közben elavult, a javaslat „ütközik” állapotba
 * kerül (ez commitolódik), és PROPOSAL_CONFLICT hibát kap a hívó: újra kell alapozni.
 *
 * Zárolási sorrend: szakasz (vagy dokumentum) → javaslat, ugyanaz, mint az írásoknál.
 */
export async function acceptProposal(db: Db, actor: Actor, input: { proposalId: string; note?: string }) {
	if (actor.kind !== 'human') {
		throw new CoreError('HUMAN_ONLY', 'Javaslatot csak ember fogadhat el, a felületről.');
	}
	const first = await getProposal(db, input.proposalId);

	const outcome = await db.transaction(async (tx) => {
		if (first.sectionId) {
			const ctx = await loadSection(tx, actor, first.sectionId, 'editor', { forUpdate: true });
			const [p] = await tx.select().from(proposal).where(eq(proposal.id, input.proposalId)).for('update');
			if (p.status !== 'open') {
				throw new CoreError('PROPOSAL_NOT_OPEN', `A javaslat már nem nyitott (${p.status}).`, { status: p.status });
			}
			if (ctx.section.deletedAt) throw new CoreError('IN_TRASH', 'A szakasz a lomtárban van.');
			await assertNotLockedByOther(tx, actor, ctx.section.id);
			if (ctx.section.revision !== p.baseRevision) {
				await tx.update(proposal).set({ status: 'conflicted' }).where(eq(proposal.id, p.id));
				await recordEvent(tx, actor, {
					projectId: ctx.project.id,
					type: 'proposal.conflicted',
					targetType: 'proposal',
					targetId: p.id,
					summary: `A javaslat elavult: „${ctx.section.title}” (${p.baseRevision}. → ${ctx.section.revision}. revízió)`,
					data: { sectionId: ctx.section.id }
				});
				return { conflict: { baseRevision: p.baseRevision, currentRevision: ctx.section.revision } } as const;
			}
			const res = await writeRevision(tx, ctx, actor, {
				title: p.proposedTitle,
				content: p.proposedContent,
				kind: 'proposal',
				reason: p.reason,
				proposalId: p.id,
				author: { userId: p.authorId, kind: p.actorKind }
			});
			await tx
				.update(proposal)
				.set({
					status: 'accepted',
					resolvedBy: actor.userId,
					resolvedAt: clock.now(),
					resolutionNote: input.note ?? null,
					appliedRevision: res.revision
				})
				.where(eq(proposal.id, p.id));
			await recordEvent(tx, actor, {
				projectId: ctx.project.id,
				type: 'proposal.accepted',
				targetType: 'proposal',
				targetId: p.id,
				summary: `Javaslat elfogadva: „${p.proposedTitle}”`,
				data: { sectionId: ctx.section.id, revision: res.revision }
			});
			return { sectionId: ctx.section.id, revision: res.revision } as const;
		}

		// Új szakasz javaslata
		const docCtx = await loadDocument(tx, actor, first.documentId, 'editor');
		await tx.select({ id: document.id }).from(document).where(eq(document.id, first.documentId)).for('update');
		const [p] = await tx.select().from(proposal).where(eq(proposal.id, input.proposalId)).for('update');
		if (p.status !== 'open') {
			throw new CoreError('PROPOSAL_NOT_OPEN', `A javaslat már nem nyitott (${p.status}).`, { status: p.status });
		}
		let afterSectionId = p.afterSectionId;
		if (afterSectionId) {
			const [after] = await tx.select({ deletedAt: section.deletedAt }).from(section).where(eq(section.id, afterSectionId));
			if (!after || after.deletedAt) afterSectionId = null; // a referencia eltűnt: a végére tesszük
		}
		const created = await createSectionTx(
			tx,
			actor,
			{ documentId: p.documentId, title: p.proposedTitle, content: p.proposedContent, afterSectionId, reason: p.reason },
			{ userId: p.authorId, kind: p.actorKind },
			p.id
		);
		await tx
			.update(proposal)
			.set({
				status: 'accepted',
				sectionId: created.sectionId,
				resolvedBy: actor.userId,
				resolvedAt: clock.now(),
				resolutionNote: input.note ?? null,
				appliedRevision: 1
			})
			.where(eq(proposal.id, p.id));
		await recordEvent(tx, actor, {
			projectId: docCtx.project.id,
			type: 'proposal.accepted',
			targetType: 'proposal',
			targetId: p.id,
			summary: `Javaslat elfogadva, új szakasz: „${p.proposedTitle}”`,
			data: { sectionId: created.sectionId, revision: 1 }
		});
		return { sectionId: created.sectionId, revision: 1 } as const;
	});

	if ('conflict' in outcome) {
		throw new CoreError(
			'PROPOSAL_CONFLICT',
			'A szakasz a javaslat óta megváltozott, ezért a javaslat „ütközik” állapotba került. Újra kell alapozni a friss tartalomra.',
			outcome.conflict
		);
	}
	return outcome;
}

/** Elutasítás: ember (szerkesztő), vagy a javaslat saját szerzője visszavonásként. */
export async function rejectProposal(db: Db, actor: Actor, input: { proposalId: string; note?: string }) {
	const first = await getProposal(db, input.proposalId);
	return db.transaction(async (tx) => {
		const ctx = await loadDocument(tx, actor, first.documentId, 'viewer');
		const [p] = await tx.select().from(proposal).where(eq(proposal.id, input.proposalId)).for('update');
		const isAuthor = p.authorId === actor.userId;
		if (!isAuthor) {
			if (actor.kind !== 'human') {
				throw new CoreError('HUMAN_ONLY', 'Más javaslatát csak ember utasíthatja el.');
			}
			await requireRole(tx, actor, ctx.project.workspaceId, 'editor');
		}
		if (p.status !== 'open' && p.status !== 'conflicted') {
			throw new CoreError('PROPOSAL_NOT_OPEN', `A javaslat már lezárult (${p.status}).`, { status: p.status });
		}
		await tx
			.update(proposal)
			.set({ status: 'rejected', resolvedBy: actor.userId, resolvedAt: clock.now(), resolutionNote: input.note ?? null })
			.where(and(eq(proposal.id, p.id)));
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: isAuthor ? 'proposal.withdrawn' : 'proposal.rejected',
			targetType: 'proposal',
			targetId: p.id,
			summary: `${isAuthor ? 'Javaslat visszavonva' : 'Javaslat elutasítva'}: „${p.proposedTitle}”${input.note ? ` – ${input.note}` : ''}`,
			data: { sectionId: p.sectionId }
		});
		return { status: 'rejected' as const };
	});
}
