import { eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { sectionSource } from '../db/schema';
import { sourceLabel } from '../repo/ref';
import { CoreError } from './errors';

export type SectionSourceRow = typeof sectionSource.$inferSelect;

/** Repóhivatkozás a válaszokban: honnan jön, mikor frissült, és ha nem sikerült, miért. */
export const sourceView = (s: SectionSourceRow) => ({
	provider: s.provider,
	repo: s.repo,
	path: s.path,
	ref: s.ref,
	webUrl: s.webUrl,
	blobSha: s.blobSha.slice(0, 7),
	syncedAt: s.syncedAt,
	checkedAt: s.checkedAt,
	lastError: s.lastError,
	readOnly: true as const
});

export type SourceView = ReturnType<typeof sourceView>;

export async function getSectionSource(db: DbOrTx, sectionId: string) {
	const [s] = await db.select().from(sectionSource).where(eq(sectionSource.sectionId, sectionId));
	return s ?? null;
}

export async function getSectionSources(db: DbOrTx, sectionIds: string[]) {
	if (!sectionIds.length) return new Map<string, SectionSourceRow>();
	const rows = await db.select().from(sectionSource).where(inArray(sectionSource.sectionId, sectionIds));
	return new Map(rows.map((r) => [r.sectionId, r]));
}

/** A repóhivatkozású szakasz csak olvasható: a forrás a repó. */
export async function assertNotRepoLinked(db: DbOrTx, section: { id: string; title: string }) {
	const s = await getSectionSource(db, section.id);
	if (!s) return;
	throw new CoreError(
		'REPO_LINKED',
		`A(z) „${section.title}” szakasz a repóból jön (${sourceLabel(s)}), itt csak olvasható. A repóban szerkeszd: ${s.webUrl} – a változás frissítéskor (refresh_section) jön át.`,
		{ sectionId: section.id, source: sourceView(s) }
	);
}
