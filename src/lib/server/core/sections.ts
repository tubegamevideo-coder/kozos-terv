import { and, asc, desc, eq, gt, isNull, lt, max, min } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '../db';
import { document, proposal, section, sectionRevision, user } from '../db/schema';
import { loadDocument, loadSection } from './access';
import { countOccurrences, unifiedDiff } from './diff';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { assertNotLockedByOther, getActiveLock, lockDetails } from './locks';
import { clock, type Actor } from './types';

export type SectionCtx = Awaited<ReturnType<typeof loadSection>>;
type RevisionKind = (typeof sectionRevision.$inferInsert)['kind'];

const requireReason = (reason: string | undefined) => {
	const r = reason?.trim();
	if (!r) throw new CoreError('VALIDATION', 'Minden íráshoz rövid indoklás kell (reason).');
	return r;
};

/** Védett dokumentumba a Claude nem írhat közvetlenül, csak javaslatot tehet. */
export function assertDirectWriteAllowed(actor: Actor, doc: { isProtected: boolean; title: string }) {
	if (doc.isProtected && actor.kind === 'claude') {
		throw new CoreError(
			'PROTECTED_DOCUMENT',
			`A(z) „${doc.title}” védett dokumentum: ide a Claude csak javaslatot tehet (propose_change), amit egy ember fogad el.`
		);
	}
}

/** Ha a hívó elavult revízióból dolgozik, visszaadja a friss tartalmat és a különbséget. */
export async function assertFreshRevision(tx: Tx, ctx: SectionCtx, baseRevision: number) {
	const current = ctx.section.revision;
	if (baseRevision === current) return;
	if (baseRevision > current || baseRevision < 1) {
		throw new CoreError('VALIDATION', `Nincs ${baseRevision}. revízió; az aktuális a ${current}.`, {
			currentRevision: current
		});
	}
	const [base] = await tx
		.select({ content: sectionRevision.content, title: sectionRevision.title })
		.from(sectionRevision)
		.where(and(eq(sectionRevision.sectionId, ctx.section.id), eq(sectionRevision.revision, baseRevision)));
	const changes = await tx
		.select({
			revision: sectionRevision.revision,
			by: user.name,
			via: sectionRevision.actorKind,
			reason: sectionRevision.reason,
			at: sectionRevision.createdAt
		})
		.from(sectionRevision)
		.innerJoin(user, eq(user.id, sectionRevision.authorId))
		.where(and(eq(sectionRevision.sectionId, ctx.section.id), gt(sectionRevision.revision, baseRevision)))
		.orderBy(asc(sectionRevision.revision));
	throw new CoreError(
		'STALE_REVISION',
		`A szakasz közben megváltozott (${baseRevision}. → ${current}. revízió). Olvasd el a friss tartalmat, és arra építve próbáld újra; semmi nem íródott felül.`,
		{
			sectionId: ctx.section.id,
			baseRevision,
			currentRevision: current,
			currentTitle: ctx.section.title,
			currentContent: ctx.section.content,
			diff: unifiedDiff(base?.content ?? '', ctx.section.content, `rev ${baseRevision}`, `rev ${current}`),
			titleChanged: base ? base.title !== ctx.section.title : undefined,
			changes: changes.map((c) => ({ ...c, at: c.at.toISOString() }))
		}
	);
}

interface WriteInput {
	title: string;
	content: string;
	kind: RevisionKind;
	reason: string;
	proposalId?: string;
	/** Javaslat elfogadásakor a revízió szerzője a javaslattevő, nem az elfogadó. */
	author?: Actor;
	deletedAt?: Date | null;
}

/**
 * Új revíziót ír egy már zárolt (FOR UPDATE) szakaszra, és a régebbi alapú nyitott javaslatokat
 * „ütközik” állapotba teszi. Csak a mag belsejéből hívható, az ellenőrzések után.
 */
export async function writeRevision(tx: Tx, ctx: SectionCtx, actor: Actor, w: WriteInput) {
	const author = w.author ?? actor;
	const next = ctx.section.revision + 1;
	const now = clock.now();
	await tx
		.update(section)
		.set({
			title: w.title,
			content: w.content,
			revision: next,
			updatedAt: now,
			...(w.deletedAt !== undefined ? { deletedAt: w.deletedAt } : {})
		})
		.where(eq(section.id, ctx.section.id));
	await tx.insert(sectionRevision).values({
		sectionId: ctx.section.id,
		revision: next,
		kind: w.kind,
		title: w.title,
		content: w.content,
		authorId: author.userId,
		actorKind: author.kind,
		reason: w.reason,
		proposalId: w.proposalId,
		createdAt: now
	});
	const conflicted = await tx
		.update(proposal)
		.set({ status: 'conflicted' })
		.where(
			and(
				eq(proposal.sectionId, ctx.section.id),
				eq(proposal.status, 'open'),
				lt(proposal.baseRevision, next)
			)
		)
		.returning({ id: proposal.id });
	await tx.update(document).set({ updatedAt: now }).where(eq(document.id, ctx.document.id));
	return { revision: next, conflictedProposalIds: conflicted.map((p) => p.id) };
}

/** A közvetlen írások közös előszobája: zárolás, lomtár, védettség, zár, revízió. */
async function prepareDirectWrite(tx: Tx, actor: Actor, sectionId: string, baseRevision: number) {
	const ctx = await loadSection(tx, actor, sectionId, 'editor', { forUpdate: true });
	if (ctx.section.deletedAt) throw new CoreError('IN_TRASH', 'A szakasz a lomtárban van.', { sectionId });
	assertDirectWriteAllowed(actor, ctx.document);
	await assertNotLockedByOther(tx, actor, sectionId);
	await assertFreshRevision(tx, ctx, baseRevision);
	return ctx;
}

// ---------------------------------------------------------------- írás

export interface EditSectionInput {
	sectionId: string;
	baseRevision: number;
	oldText: string;
	newText: string;
	reason: string;
}

/** Célzott módosítás keresés-csere módon. A régi szövegnek pontosan egyszer kell szerepelnie. */
export async function editSection(db: Db, actor: Actor, input: EditSectionInput) {
	const reason = requireReason(input.reason);
	if (!input.oldText) throw new CoreError('VALIDATION', 'Az oldText nem lehet üres.');
	return db.transaction(async (tx) => {
		const ctx = await prepareDirectWrite(tx, actor, input.sectionId, input.baseRevision);
		const n = countOccurrences(ctx.section.content, input.oldText);
		if (n === 0) {
			throw new CoreError('EDIT_NO_MATCH', 'A régi szöveg nem található a szakaszban. Olvasd újra a szakaszt, és pontosan másold ki.', {
				revision: ctx.section.revision
			});
		}
		if (n > 1) {
			throw new CoreError('EDIT_AMBIGUOUS', `A régi szöveg ${n}-szer szerepel; adj meg hosszabb, egyedi részletet.`, {
				occurrences: n
			});
		}
		const content = ctx.section.content.replace(input.oldText, () => input.newText);
		const res = await writeRevision(tx, ctx, actor, { title: ctx.section.title, content, kind: 'edit', reason });
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'section.edited',
			targetType: 'section',
			targetId: ctx.section.id,
			summary: `Módosítva: „${ctx.section.title}” – ${reason}`,
			data: { documentId: ctx.document.id, revision: res.revision, ...conflictData(res) }
		});
		return { sectionId: ctx.section.id, ...res };
	});
}

export interface ReplaceSectionInput {
	sectionId: string;
	baseRevision: number;
	title?: string;
	content: string;
	reason: string;
}

export async function replaceSection(db: Db, actor: Actor, input: ReplaceSectionInput) {
	const reason = requireReason(input.reason);
	return db.transaction(async (tx) => {
		const ctx = await prepareDirectWrite(tx, actor, input.sectionId, input.baseRevision);
		const title = input.title?.trim() || ctx.section.title;
		const res = await writeRevision(tx, ctx, actor, { title, content: input.content, kind: 'replace', reason });
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'section.replaced',
			targetType: 'section',
			targetId: ctx.section.id,
			summary: `Átírva: „${title}” – ${reason}`,
			data: { documentId: ctx.document.id, revision: res.revision, ...conflictData(res) }
		});
		return { sectionId: ctx.section.id, ...res };
	});
}

/** Lomtárba teszi (nem törli). A revíziószám nő, így a régi alapú írások elavulnak. */
export async function trashSection(
	db: Db,
	actor: Actor,
	input: { sectionId: string; baseRevision: number; reason: string }
) {
	const reason = requireReason(input.reason);
	return db.transaction(async (tx) => {
		const ctx = await prepareDirectWrite(tx, actor, input.sectionId, input.baseRevision);
		const res = await writeRevision(tx, ctx, actor, {
			title: ctx.section.title,
			content: ctx.section.content,
			kind: 'trash',
			reason,
			deletedAt: clock.now()
		});
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'section.trashed',
			targetType: 'section',
			targetId: ctx.section.id,
			summary: `Lomtárba: „${ctx.section.title}” – ${reason}`,
			data: { documentId: ctx.document.id, revision: res.revision }
		});
		return { sectionId: ctx.section.id, ...res };
	});
}

/** Egy korábbi revízió tartalmát állítja vissza, új revízióként (a közte lévők megmaradnak). */
export async function restoreRevision(
	db: Db,
	actor: Actor,
	input: { sectionId: string; baseRevision: number; toRevision: number; reason: string }
) {
	const reason = requireReason(input.reason);
	return db.transaction(async (tx) => {
		const ctx = await loadSection(tx, actor, input.sectionId, 'editor', { forUpdate: true });
		assertDirectWriteAllowed(actor, ctx.document);
		await assertNotLockedByOther(tx, actor, input.sectionId);
		await assertFreshRevision(tx, ctx, input.baseRevision);
		const [old] = await tx
			.select()
			.from(sectionRevision)
			.where(and(eq(sectionRevision.sectionId, input.sectionId), eq(sectionRevision.revision, input.toRevision)));
		if (!old) throw new CoreError('NOT_FOUND', `Nincs ${input.toRevision}. revízió.`);
		const res = await writeRevision(tx, ctx, actor, {
			title: old.title,
			content: old.content,
			kind: ctx.section.deletedAt ? 'untrash' : 'restore',
			reason,
			deletedAt: null
		});
		await recordEvent(tx, actor, {
			projectId: ctx.project.id,
			type: 'section.restored',
			targetType: 'section',
			targetId: ctx.section.id,
			summary: `Visszaállítva a ${input.toRevision}. revízióra: „${old.title}” – ${reason}`,
			data: { documentId: ctx.document.id, revision: res.revision, from: input.toRevision }
		});
		return { sectionId: ctx.section.id, ...res };
	});
}

export interface CreateSectionInput {
	documentId: string;
	title: string;
	content?: string;
	/** Melyik szakasz után; ha nincs megadva, a dokumentum végére. */
	afterSectionId?: string | null;
	reason: string;
}

/** Új szakaszt hoz létre; a dokumentum sorát zárolja, hogy két párhuzamos beszúrás ne ütközzön. */
export async function createSectionTx(tx: Tx, actor: Actor, input: CreateSectionInput, author?: Actor, proposalId?: string) {
	const ctx = await loadDocument(tx, actor, input.documentId, 'editor');
	await tx.select({ id: document.id }).from(document).where(eq(document.id, input.documentId)).for('update');
	const position = await positionAfter(tx, input.documentId, input.afterSectionId ?? null);
	const by = author ?? actor;
	const [s] = await tx
		.insert(section)
		.values({
			documentId: input.documentId,
			title: input.title.trim(),
			content: input.content ?? '',
			position,
			revision: 1
		})
		.returning();
	await tx.insert(sectionRevision).values({
		sectionId: s.id,
		revision: 1,
		kind: proposalId ? 'proposal' : 'create',
		title: s.title,
		content: s.content,
		authorId: by.userId,
		actorKind: by.kind,
		reason: input.reason,
		proposalId
	});
	await tx.update(document).set({ updatedAt: clock.now() }).where(eq(document.id, input.documentId));
	await recordEvent(tx, actor, {
		projectId: ctx.project.id,
		type: 'section.created',
		targetType: 'section',
		targetId: s.id,
		summary: `Új szakasz: „${s.title}” (${ctx.document.title})`,
		data: { documentId: input.documentId, revision: 1 }
	});
	return { sectionId: s.id, revision: 1, position };
}

export async function createSection(db: Db, actor: Actor, input: CreateSectionInput) {
	const reason = requireReason(input.reason);
	if (!input.title?.trim()) throw new CoreError('VALIDATION', 'A szakasznak cím kell.');
	return db.transaction(async (tx) => {
		const ctx = await loadDocument(tx, actor, input.documentId, 'editor');
		assertDirectWriteAllowed(actor, ctx.document);
		return createSectionTx(tx, actor, { ...input, reason });
	});
}

async function positionAfter(tx: Tx, documentId: string, afterSectionId: string | null) {
	const live = and(eq(section.documentId, documentId), isNull(section.deletedAt));
	if (!afterSectionId) {
		const [r] = await tx.select({ m: max(section.position) }).from(section).where(live);
		return (r?.m ?? 0) + 1;
	}
	const [after] = await tx
		.select({ position: section.position })
		.from(section)
		.where(and(eq(section.id, afterSectionId), eq(section.documentId, documentId)));
	if (!after) throw new CoreError('NOT_FOUND', 'Az afterSectionId nem ebben a dokumentumban van.');
	const [next] = await tx
		.select({ m: min(section.position) })
		.from(section)
		.where(and(live, gt(section.position, after.position)));
	return next?.m == null ? after.position + 1 : (after.position + next.m) / 2;
}

const conflictData = (res: { conflictedProposalIds: string[] }) =>
	res.conflictedProposalIds.length ? { conflictedProposals: res.conflictedProposalIds } : {};

// ---------------------------------------------------------------- olvasás

export async function readSection(db: DbOrTx, actor: Actor, sectionId: string) {
	const ctx = await loadSection(db, actor, sectionId, 'viewer');
	const lock = await getActiveLock(db, sectionId);
	const openProposals = await db
		.select({
			id: proposal.id,
			baseRevision: proposal.baseRevision,
			reason: proposal.reason,
			by: user.name,
			via: proposal.actorKind,
			createdAt: proposal.createdAt
		})
		.from(proposal)
		.innerJoin(user, eq(user.id, proposal.authorId))
		.where(and(eq(proposal.sectionId, sectionId), eq(proposal.status, 'open')));
	return {
		id: ctx.section.id,
		documentId: ctx.document.id,
		documentTitle: ctx.document.title,
		isProtected: ctx.document.isProtected,
		title: ctx.section.title,
		content: ctx.section.content,
		revision: ctx.section.revision,
		inTrash: !!ctx.section.deletedAt,
		updatedAt: ctx.section.updatedAt,
		lock: lock ? lockDetails(lock) : null,
		openProposals
	};
}

export async function listRevisions(db: DbOrTx, actor: Actor, sectionId: string) {
	await loadSection(db, actor, sectionId, 'viewer');
	return db
		.select({
			revision: sectionRevision.revision,
			kind: sectionRevision.kind,
			title: sectionRevision.title,
			by: user.name,
			via: sectionRevision.actorKind,
			reason: sectionRevision.reason,
			createdAt: sectionRevision.createdAt
		})
		.from(sectionRevision)
		.innerJoin(user, eq(user.id, sectionRevision.authorId))
		.where(eq(sectionRevision.sectionId, sectionId))
		.orderBy(desc(sectionRevision.revision));
}
