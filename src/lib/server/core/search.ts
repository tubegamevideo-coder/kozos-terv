import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { document, idea, question, section } from '../db/schema';
import { loadProject } from './access';
import { CoreError } from './errors';
import type { Actor } from './types';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * Keresés a projektben: szakaszok teljes szöveges kereséssel (magyar szótövezés, a cím többet ér),
 * kérdések és ötletek részszöveg-egyezéssel. Találatonként rövid, kiemelt részlet.
 */
export async function searchProject(
	db: DbOrTx,
	actor: Actor,
	input: { projectId: string; query: string; limit?: number }
) {
	const q = input.query?.trim();
	if (!q) throw new CoreError('VALIDATION', 'Üres keresőkifejezés.');
	await loadProject(db, actor, input.projectId, 'viewer');
	const limit = Math.min(Math.max(input.limit ?? 15, 1), 50);
	const tsq = sql`websearch_to_tsquery('hungarian', ${q})`;
	const like = `%${escapeLike(q)}%`;

	const sections = await db
		.select({
			sectionId: section.id,
			title: section.title,
			revision: section.revision,
			documentId: document.id,
			documentTitle: document.title,
			rank: sql<number>`ts_rank(${section.search}, ${tsq})`,
			snippet: sql<string>`ts_headline('hungarian', ${section.content}, ${tsq}, 'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=2, FragmentDelimiter= … ')`
		})
		.from(section)
		.innerJoin(document, eq(document.id, section.documentId))
		.where(
			and(
				eq(document.projectId, input.projectId),
				isNull(section.deletedAt),
				isNull(document.deletedAt),
				or(sql`${section.search} @@ ${tsq}`, ilike(section.title, like), ilike(section.content, like))
			)
		)
		.orderBy(desc(sql`ts_rank(${section.search}, ${tsq})`))
		.limit(limit);

	const questions = await db
		.select({ id: question.id, title: question.title, status: question.status, decision: question.decision })
		.from(question)
		.where(
			and(
				eq(question.projectId, input.projectId),
				or(ilike(question.title, like), ilike(question.body, like), ilike(question.decision, like))
			)
		)
		.limit(limit);

	const ideas = await db
		.select({ id: idea.id, title: idea.title, status: idea.status })
		.from(idea)
		.where(and(eq(idea.projectId, input.projectId), or(ilike(idea.title, like), ilike(idea.body, like))))
		.limit(limit);

	return { sections, questions, ideas };
}
