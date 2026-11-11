import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import {
	document,
	event,
	project,
	projectVisit,
	proposal,
	section,
	sectionLock,
	sectionRevision,
	user,
	workspace,
	workspaceMember
} from '../db/schema';
import { loadDocument, loadProject } from './access';
import { getChangesSinceLastVisit, markVisit, type VisitChannel } from './changes';
import { listQuestions } from './questions';
import { clock, type Actor } from './types';

/** Az első mondat (vagy legfeljebb ~160 karakter) a vázlatnézethez, Markdown-jelölések nélkül. */
export function firstSentence(md: string, max = 160) {
	const text = md
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#+\s*/gm, '')
		.replace(/[*_`>|]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	const m = text.match(/^(.+?[.!?])(\s|$)/);
	const s = m && m[1].length <= max ? m[1] : text;
	return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** A felhasználó projektjei minden munkaterében, az olvasatlan (mások általi) változások számával. */
export async function listProjects(db: DbOrTx, actor: Actor, opts: { channel?: VisitChannel } = {}) {
	const channel = opts.channel ?? 'mcp';
	const unseen = sql<number>`(
		select count(*)::int from ${event}
		where ${event.projectId} = ${project.id}
		  and ${event.actorId} <> ${actor.userId}
		  and ${event.id} > coalesce((
			select ${projectVisit.lastEventId} from ${projectVisit}
			where ${projectVisit.userId} = ${actor.userId}
			  and ${projectVisit.projectId} = ${project.id}
			  and ${projectVisit.channel} = ${channel}), 0)
	)`;
	return db
		.select({
			id: project.id,
			name: project.name,
			goal: project.goal,
			status: project.status,
			workspace: workspace.name,
			role: workspaceMember.role,
			updatedAt: project.updatedAt,
			unseenChanges: unseen
		})
		.from(project)
		.innerJoin(workspace, eq(workspace.id, project.workspaceId))
		.innerJoin(
			workspaceMember,
			and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, actor.userId))
		)
		.where(and(isNull(project.deletedAt), isNull(workspace.deletedAt)))
		.orderBy(asc(workspace.name), asc(project.name));
}

async function activeLocks(db: DbOrTx, sectionIds: string[]) {
	if (!sectionIds.length) return new Map<string, { sectionId: string; heldBy: string; heldByUserId: string; via: string; purpose: string; expiresAt: string }>();
	const rows = await db
		.select({
			sectionId: sectionLock.sectionId,
			heldBy: user.name,
			heldByUserId: sectionLock.holderId,
			via: sectionLock.actorKind,
			purpose: sectionLock.purpose,
			expiresAt: sectionLock.expiresAt
		})
		.from(sectionLock)
		.innerJoin(user, eq(user.id, sectionLock.holderId))
		.where(and(inArray(sectionLock.sectionId, sectionIds), gt(sectionLock.expiresAt, clock.now())));
	return new Map(rows.map((r) => [r.sectionId, { ...r, expiresAt: r.expiresAt.toISOString() }]));
}

async function openProposalCounts(db: DbOrTx, sectionIds: string[]) {
	if (!sectionIds.length) return new Map<string, number>();
	const rows = await db
		.select({ sectionId: proposal.sectionId, n: count() })
		.from(proposal)
		.where(and(inArray(proposal.sectionId, sectionIds), eq(proposal.status, 'open')))
		.groupBy(proposal.sectionId);
	return new Map(rows.map((r) => [r.sectionId!, r.n]));
}

export interface DocumentSectionView {
	id: string;
	title: string;
	revision: number;
	/** `full` esetén */
	content?: string;
	/** vázlatnézetben: első mondat és a teljes hossz karakterben */
	summary?: string;
	length?: number;
	lock: { sectionId: string; heldBy: string; heldByUserId: string; via: string; purpose: string; expiresAt: string } | null;
	openProposals: number;
	/** Ki írt bele utoljára (ember vagy a Claude-ja). */
	lastEdit: { by: string; userId: string; via: 'human' | 'claude'; at: Date } | null;
	updatedAt: Date;
}

/**
 * Egy dokumentum szakaszai. Alapból vázlat (cím, első mondat, revízió, zár), `full` esetén a teljes
 * Markdown-tartalommal. A revíziószámmal a Claude közvetlenül írhat (baseRevision).
 */
export async function readDocument(
	db: DbOrTx,
	actor: Actor,
	input: { documentId: string; full?: boolean; sectionIds?: string[] }
) {
	const ctx = await loadDocument(db, actor, input.documentId, 'viewer');
	const conds = [eq(section.documentId, input.documentId), isNull(section.deletedAt)];
	if (input.sectionIds?.length) conds.push(inArray(section.id, input.sectionIds));
	const rows = await db
		.select({
			id: section.id,
			title: section.title,
			content: section.content,
			revision: section.revision,
			updatedAt: section.updatedAt
		})
		.from(section)
		.where(and(...conds))
		.orderBy(asc(section.position));
	const ids = rows.map((r) => r.id);
	const lastEdits = ids.length
		? await db
				.selectDistinctOn([sectionRevision.sectionId], {
					sectionId: sectionRevision.sectionId,
					by: user.name,
					userId: user.id,
					via: sectionRevision.actorKind,
					at: sectionRevision.createdAt
				})
				.from(sectionRevision)
				.innerJoin(user, eq(user.id, sectionRevision.authorId))
				.where(inArray(sectionRevision.sectionId, ids))
				.orderBy(sectionRevision.sectionId, desc(sectionRevision.revision))
		: [];
	const lastBy = new Map(lastEdits.map((e) => [e.sectionId, { by: e.by, userId: e.userId, via: e.via, at: e.at }]));
	const [locks, props, [newSecProps]] = await Promise.all([
		activeLocks(db, ids),
		openProposalCounts(db, ids),
		db
			.select({ n: count() })
			.from(proposal)
			.where(and(eq(proposal.documentId, input.documentId), isNull(proposal.sectionId), eq(proposal.status, 'open')))
	]);
	return {
		id: ctx.document.id,
		title: ctx.document.title,
		kind: ctx.document.kind,
		isProtected: ctx.document.isProtected,
		projectId: ctx.project.id,
		openNewSectionProposals: newSecProps?.n ?? 0,
		sections: rows.map(
			(r): DocumentSectionView => ({
				id: r.id,
				title: r.title,
				revision: r.revision,
				...(input.full ? { content: r.content } : { summary: firstSentence(r.content), length: r.content.length }),
				lock: locks.get(r.id) ?? null,
				openProposals: props.get(r.id) ?? 0,
				lastEdit: lastBy.get(r.id) ?? null,
				updatedAt: r.updatedAt
			})
		)
	};
}

/**
 * Egy hívásban minden, amivel egy beszélgetés indulhat: projektutasítás, tartalomjegyzék, nyitott
 * kérdések, aktív zárak, nyitott javaslatok és a mások változásai az utolsó látogatás óta.
 * Utána a látogatást rögzíti, így a következő összefoglaló csak az újakat mutatja.
 */
export async function getProjectBrief(
	db: Db,
	actor: Actor,
	input: { projectId: string; channel?: VisitChannel; markSeen?: boolean; changesLimit?: number }
) {
	const channel = input.channel ?? 'mcp';
	const { project: p, role } = await loadProject(db, actor, input.projectId, 'viewer');

	const docs = await db
		.select({ id: document.id, title: document.title, kind: document.kind, isProtected: document.isProtected })
		.from(document)
		.where(and(eq(document.projectId, p.id), isNull(document.deletedAt)))
		.orderBy(asc(document.position), asc(document.createdAt));
	const secs = docs.length
		? await db
				.select({ id: section.id, documentId: section.documentId, title: section.title, revision: section.revision })
				.from(section)
				.where(and(inArray(section.documentId, docs.map((d) => d.id)), isNull(section.deletedAt)))
				.orderBy(asc(section.position))
		: [];
	const locks = await activeLocks(db, secs.map((s) => s.id));
	const secTitle = new Map(secs.map((s) => [s.id, s.title]));

	const openProps = docs.length
		? await db
				.select({
					id: proposal.id,
					sectionId: proposal.sectionId,
					documentId: proposal.documentId,
					title: proposal.proposedTitle,
					reason: proposal.reason,
					by: user.name,
					via: proposal.actorKind,
					createdAt: proposal.createdAt
				})
				.from(proposal)
				.innerJoin(user, eq(user.id, proposal.authorId))
				.where(and(inArray(proposal.documentId, docs.map((d) => d.id)), eq(proposal.status, 'open')))
				.orderBy(asc(proposal.createdAt))
		: [];

	const questions = await listQuestions(db, actor, { projectId: p.id, status: ['open', 'disputed'] });
	const members = await db
		.select({ name: user.name, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(user, eq(user.id, workspaceMember.userId))
		.where(and(eq(workspaceMember.workspaceId, p.workspaceId), ne(workspaceMember.userId, actor.userId)));
	const changes = await getChangesSinceLastVisit(db, actor, {
		projectId: p.id,
		channel,
		limit: input.changesLimit ?? 40
	});
	if (input.markSeen ?? true) {
		await markVisit(db, actor, { projectId: p.id, channel, upToEventId: changes.nextCursor });
	}

	return {
		project: { id: p.id, name: p.name, goal: p.goal, status: p.status, yourRole: role },
		instructions: p.instructions,
		otherMembers: members,
		documents: docs.map((d) => ({
			...d,
			sections: secs
				.filter((s) => s.documentId === d.id)
				.map((s) => ({ id: s.id, title: s.title, revision: s.revision, ...(locks.has(s.id) ? { lock: locks.get(s.id) } : {}) }))
		})),
		openQuestions: questions.map((q) => ({ id: q.id, title: q.title, status: q.status, raisedBy: q.raisedBy })),
		activeLocks: [...locks.values()].map((l) => ({ ...l, sectionTitle: secTitle.get(l.sectionId) })),
		openProposals: openProps.map((x) => ({
			...x,
			sectionTitle: x.sectionId ? secTitle.get(x.sectionId) : null,
			newSection: !x.sectionId
		})),
		changesSinceLastVisit: {
			lastVisitedAt: changes.lastVisitedAt,
			hasMore: changes.hasMore,
			cursor: changes.nextCursor,
			items: changes.items.map((e) => ({ id: e.id, at: e.at, by: e.by, byUserId: e.byUserId, via: e.via, type: e.type, summary: e.summary, targetId: e.targetId, data: e.data }))
		}
	};
}
