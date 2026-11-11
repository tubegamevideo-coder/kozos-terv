import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { document, proposal, section, sectionRevision, user } from '../db/schema';
import { loadProject, loadSection } from './access';
import { lineDiff } from './diff';
import { CoreError } from './errors';
import type { Actor } from './types';

type ProposalStatus = 'open' | 'accepted' | 'rejected' | 'conflicted';

/**
 * A projekt javaslatai a felülethez: a javasolt tartalom különbsége ahhoz a változathoz képest,
 * amelyre a javaslat épült (új szakasznál az üreshez képest).
 */
export async function listProposals(
	db: DbOrTx,
	actor: Actor,
	input: { projectId: string; status?: ProposalStatus[]; limit?: number }
) {
	await loadProject(db, actor, input.projectId, 'viewer');
	const status = input.status ?? ['open', 'conflicted'];
	const rows = await db
		.select({
			id: proposal.id,
			status: proposal.status,
			sectionId: proposal.sectionId,
			documentId: proposal.documentId,
			documentTitle: document.title,
			baseRevision: proposal.baseRevision,
			title: proposal.proposedTitle,
			content: proposal.proposedContent,
			reason: proposal.reason,
			by: user.name,
			via: proposal.actorKind,
			createdAt: proposal.createdAt,
			resolutionNote: proposal.resolutionNote,
			resolvedAt: proposal.resolvedAt
		})
		.from(proposal)
		.innerJoin(document, eq(document.id, proposal.documentId))
		.innerJoin(user, eq(user.id, proposal.authorId))
		.where(and(eq(document.projectId, input.projectId), inArray(proposal.status, status)))
		.orderBy(desc(proposal.createdAt))
		.limit(input.limit ?? 100);

	const out = [];
	for (const p of rows) {
		let baseTitle: string | null = null;
		let baseContent = '';
		let currentRevision: number | null = null;
		if (p.sectionId && p.baseRevision) {
			const [base] = await db
				.select({ title: sectionRevision.title, content: sectionRevision.content })
				.from(sectionRevision)
				.where(and(eq(sectionRevision.sectionId, p.sectionId), eq(sectionRevision.revision, p.baseRevision)));
			baseTitle = base?.title ?? null;
			baseContent = base?.content ?? '';
			const [cur] = await db.select({ revision: section.revision }).from(section).where(eq(section.id, p.sectionId));
			currentRevision = cur?.revision ?? null;
		}
		out.push({
			...p,
			newSection: !p.sectionId || !p.baseRevision,
			baseTitle,
			titleChanged: baseTitle !== null && baseTitle !== p.title,
			currentRevision,
			stale: currentRevision !== null && currentRevision !== p.baseRevision,
			diff: lineDiff(baseContent, p.content)
		});
	}
	return out;
}

/** Egy szakasz két revíziója közötti különbség (előzménynézet). */
export async function compareRevisions(
	db: DbOrTx,
	actor: Actor,
	input: { sectionId: string; from: number; to: number }
) {
	await loadSection(db, actor, input.sectionId, 'viewer');
	const revs = await db
		.select({ revision: sectionRevision.revision, title: sectionRevision.title, content: sectionRevision.content })
		.from(sectionRevision)
		.where(and(eq(sectionRevision.sectionId, input.sectionId), inArray(sectionRevision.revision, [input.from, input.to])));
	const a = revs.find((r) => r.revision === input.from);
	const b = revs.find((r) => r.revision === input.to);
	if (!a || !b) throw new CoreError('NOT_FOUND', 'Nincs ilyen revízió.');
	return { from: a, to: b, diff: lineDiff(a.content, b.content) };
}

/** A lomtárban lévő szakaszok (visszaállítás az előzményből). */
export async function listTrashedSections(db: DbOrTx, actor: Actor, projectId: string) {
	await loadProject(db, actor, projectId, 'viewer');
	return db
		.select({ id: section.id, title: section.title, documentTitle: document.title, deletedAt: section.deletedAt })
		.from(section)
		.innerJoin(document, eq(document.id, section.documentId))
		.where(and(eq(document.projectId, projectId), isNotNull(section.deletedAt)))
		.orderBy(desc(section.deletedAt));
}
