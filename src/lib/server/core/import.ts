import type { Db } from '../db';
import { document } from '../db/schema';
import { loadProject } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { createSectionTx } from './sections';
import type { Actor } from './types';

type DocumentKind = (typeof document.$inferInsert)['kind'] & string;

export interface ParsedSection {
	title: string;
	content: string;
}

/**
 * Markdownt szakaszokra bont a `level` szintű (alapból `##`) címsoroknál. Kódblokkon belüli
 * `#`-sorokat nem tekint címnek. Az első `#` cím a dokumentum címe; az előtte/utána álló,
 * címsor nélküli szöveg „Bevezetés” szakasz lesz.
 */
export function splitMarkdown(markdown: string, level = 2): { title: string | null; sections: ParsedSection[] } {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const heading = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`);
	const top = /^#\s+(.+?)\s*#*\s*$/;
	let inFence = false;
	let docTitle: string | null = null;
	const sections: ParsedSection[] = [];
	let cur: { title: string; lines: string[] } = { title: 'Bevezetés', lines: [] };
	const flush = () => {
		const content = cur.lines.join('\n').trim();
		if (content || cur.title !== 'Bevezetés') sections.push({ title: cur.title, content });
	};
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		if (!inFence) {
			const t = level > 1 ? line.match(top) : null;
			if (t && docTitle === null && sections.length === 0 && !cur.lines.some((l) => l.trim())) {
				docTitle = t[1];
				continue;
			}
			const h = line.match(heading);
			if (h) {
				flush();
				cur = { title: h[1], lines: [] };
				continue;
			}
		}
		cur.lines.push(line);
	}
	flush();
	return { title: docTitle, sections };
}

/** Markdown-dokumentum importja új dokumentumként. Csak ember (felület, seed); a Claude szakaszonként ír. */
export async function importMarkdown(
	db: Db,
	actor: Actor,
	input: { projectId: string; markdown: string; title?: string; kind?: DocumentKind; isProtected?: boolean; level?: number }
) {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', 'Importálni csak ember tud.');
	const parsed = splitMarkdown(input.markdown, input.level ?? 2);
	const title = input.title?.trim() || parsed.title || 'Importált dokumentum';
	const kind = input.kind ?? 'note';
	return db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'editor');
		const [d] = await tx
			.insert(document)
			.values({
				projectId: p.id,
				title,
				kind,
				isProtected: input.isProtected ?? kind === 'main_plan',
				createdBy: actor.userId
			})
			.returning();
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'document.imported',
			targetType: 'document',
			targetId: d.id,
			summary: `Importálva: „${title}” (${parsed.sections.length} szakasz)`
		});
		const sectionIds: string[] = [];
		for (const s of parsed.sections) {
			const r = await createSectionTx(tx, actor, { documentId: d.id, title: s.title, content: s.content, reason: 'import' });
			sectionIds.push(r.sectionId);
		}
		return { documentId: d.id, title, sectionIds };
	});
}
