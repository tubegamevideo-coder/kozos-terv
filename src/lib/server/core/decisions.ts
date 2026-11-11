import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { document, project, question, user } from '../db/schema';
import { loadProject } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { createSectionTx } from './sections';
import { clock, type Actor } from './types';

const DECISION_LOG_TITLE = 'Döntésnapló';

/**
 * Döntés rögzítése a projekt döntésnaplójába (új szakaszként; ha nincs napló, létrehozza).
 * Ha kérdéshez tartozik, a kérdést „eldőlt” állapotba teszi ugyanebben a tranzakcióban.
 */
export async function logDecision(
	db: Db,
	actor: Actor,
	input: { projectId: string; title: string; decision: string; rationale?: string; questionId?: string }
) {
	const title = input.title?.trim();
	const decision = input.decision?.trim();
	if (!title || !decision) throw new CoreError('VALIDATION', 'A döntéshez cím és a döntés szövege kell.');
	return db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'editor');
		// Ugyanarra a projektre egyszerre csak egy napló jöjjön létre.
		await tx.select({ id: project.id }).from(project).where(eq(project.id, p.id)).for('update');
		let [log] = await tx
			.select()
			.from(document)
			.where(and(eq(document.projectId, p.id), eq(document.kind, 'decision_log'), isNull(document.deletedAt)))
			.orderBy(asc(document.createdAt))
			.limit(1);
		if (!log) {
			[log] = await tx
				.insert(document)
				.values({ projectId: p.id, title: DECISION_LOG_TITLE, kind: 'decision_log', createdBy: actor.userId })
				.returning();
			await recordEvent(tx, actor, {
				projectId: p.id,
				type: 'document.created',
				targetType: 'document',
				targetId: log.id,
				summary: `Új dokumentum: „${DECISION_LOG_TITLE}”`
			});
		}

		let q: typeof question.$inferSelect | undefined;
		if (input.questionId) {
			[q] = await tx.select().from(question).where(eq(question.id, input.questionId)).for('update');
			if (!q || q.projectId !== p.id) throw new CoreError('NOT_FOUND', 'Nincs ilyen kérdés ebben a projektben.');
		}

		const [me] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
		const now = clock.now();
		const day = now.toISOString().slice(0, 10);
		const content = [
			`**Döntés:** ${decision}`,
			input.rationale?.trim() ? `**Indoklás:** ${input.rationale.trim()}` : null,
			q ? `**Kérdés:** ${q.title}` : null,
			`**Rögzítette:** ${me?.name ?? '?'}${actor.kind === 'claude' ? ' (Claude-on keresztül)' : ''}, ${day}`
		]
			.filter(Boolean)
			.join('\n\n');
		const created = await createSectionTx(tx, actor, {
			documentId: log.id,
			title: `${day} – ${title}`,
			content,
			reason: 'döntés rögzítése'
		});

		if (q) {
			await tx
				.update(question)
				.set({
					status: 'decided',
					decision,
					decidedBy: actor.userId,
					decidedAt: now,
					relatedSectionIds: [...new Set([...q.relatedSectionIds, created.sectionId])],
					updatedAt: now
				})
				.where(eq(question.id, q.id));
		}
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'decision.logged',
			targetType: 'section',
			targetId: created.sectionId,
			summary: `Döntés: ${title} – ${decision}`,
			data: { questionId: q?.id ?? null }
		});
		return { documentId: log.id, sectionId: created.sectionId, questionDecided: !!q };
	});
}
