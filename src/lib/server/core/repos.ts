import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { projectRepo, section, sectionSource, user } from '../db/schema';
import { fileToSection } from '../repo/content';
import { repoClient, RepoFetchError, type FetchedFile, type FileLocation, type RepoAuth } from '../repo/client';
import { normalizePath, normalizeRef, parseRepoInput, sourceLabel, type RepoProvider } from '../repo/ref';
import { removeGitCache } from '../repo/ssh';
import { generateSshKey, keyStore } from '../repo/sshkey';
import { loadDocument, loadProject, loadSection } from './access';
import { CoreError } from './errors';
import { recordEvent } from './events';
import { assertDirectWriteAllowed, createSectionTx, writeRevision } from './sections';
import { sourceView } from './sources';
import { clock, type Actor } from './types';

/** Ennyi ideig fogadjuk el a legutóbbi ellenőrzést olvasáskor (`REPO_SYNC_TTL_SECONDS`, alapból 300). */
export function repoSyncTtlMs() {
	const s = Number(process.env.REPO_SYNC_TTL_SECONDS ?? 300);
	return Number.isFinite(s) && s >= 0 ? s * 1000 : 300_000;
}

const requireReason = (reason: string | undefined) => {
	const r = reason?.trim();
	if (!r) throw new CoreError('VALIDATION', 'Minden íráshoz rövid indoklás kell (reason).');
	return r;
};

const humanOnly = (actor: Actor, what: string) => {
	if (actor.kind !== 'human') throw new CoreError('HUMAN_ONLY', `${what} csak ember módosíthatja, a felületen (Beállítások).`);
};

// ---------------------------------------------------------------- hivatkozható repók

/** A projektben hivatkozható repók (élők), felvétel szerint. */
export async function listProjectRepos(db: DbOrTx, actor: Actor, projectId: string) {
	await loadProject(db, actor, projectId, 'viewer');
	return db
		.select({
			id: projectRepo.id,
			provider: projectRepo.provider,
			repo: projectRepo.repo,
			addedBy: user.name,
			createdAt: projectRepo.createdAt,
			// Csak a nyilvános kulcs; a privát a szerveren marad.
			sshPublicKey: projectRepo.sshPublicKey,
			sshFingerprint: projectRepo.sshFingerprint,
			sshKeyCreatedAt: projectRepo.sshKeyCreatedAt,
			sshVerifiedAt: projectRepo.sshVerifiedAt
		})
		.from(projectRepo)
		.innerJoin(user, eq(user.id, projectRepo.createdBy))
		.where(and(eq(projectRepo.projectId, projectId), isNull(projectRepo.deletedAt)))
		.orderBy(asc(projectRepo.createdAt));
}

/** Repó felvétele a hivatkozhatók közé (a munkatér tulajdonosa, emberként). Már felvett repónál nem változik semmi. */
export async function addProjectRepo(db: Db, actor: Actor, input: { projectId: string; repo: string; provider?: RepoProvider }) {
	humanOnly(actor, 'A hivatkozható repókat');
	const loc = parseRepoInput(input.repo, input.provider);
	return db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'owner');
		const live = and(eq(projectRepo.projectId, p.id), eq(projectRepo.provider, loc.provider), eq(projectRepo.repo, loc.repo), isNull(projectRepo.deletedAt));
		const [existing] = await tx.select({ id: projectRepo.id }).from(projectRepo).where(live);
		if (existing) return { id: existing.id, provider: loc.provider, repo: loc.repo, added: false };
		const [row] = await tx
			.insert(projectRepo)
			.values({ projectId: p.id, provider: loc.provider, repo: loc.repo, createdBy: actor.userId })
			.returning({ id: projectRepo.id });
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'project.repo_added',
			targetType: 'project',
			targetId: p.id,
			summary: `Hivatkozható repó: ${loc.repo} (${loc.provider === 'github' ? 'GitHub' : 'GitLab'})`,
			data: { provider: loc.provider, repo: loc.repo }
		});
		return { id: row.id, provider: loc.provider, repo: loc.repo, added: true };
	});
}

/**
 * Repó kivétele a hivatkozhatók közül. A meglévő szakaszok megmaradnak, de már nem frissülnek.
 * Az SSH-kulcsa is törlődik (a kulcsfájl ténylegesen: titkot nem tartunk meg feleslegesen).
 */
export async function removeProjectRepo(db: Db, actor: Actor, input: { projectId: string; repoId: string }) {
	humanOnly(actor, 'A hivatkozható repókat');
	const removed = await db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'owner');
		const [old] = await tx
			.select({ sshPublicKey: projectRepo.sshPublicKey })
			.from(projectRepo)
			.where(and(eq(projectRepo.id, input.repoId), eq(projectRepo.projectId, p.id), isNull(projectRepo.deletedAt)))
			.for('update');
		const [row] = await tx
			.update(projectRepo)
			.set({ deletedAt: clock.now(), sshPublicKey: null, sshFingerprint: null, sshKeyCreatedAt: null, sshVerifiedAt: null })
			.where(and(eq(projectRepo.id, input.repoId), eq(projectRepo.projectId, p.id), isNull(projectRepo.deletedAt)))
			.returning({ id: projectRepo.id, provider: projectRepo.provider, repo: projectRepo.repo });
		if (!row) throw new CoreError('NOT_FOUND', 'Nincs ilyen hivatkozható repó ebben a projektben.');
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'project.repo_removed',
			targetType: 'project',
			targetId: p.id,
			summary: `Már nem hivatkozható: ${row.repo}`,
			data: { provider: row.provider, repo: row.repo }
		});
		return { id: row.id, sshPublicKey: old?.sshPublicKey ?? null };
	});
	if (removed.sshPublicKey) await keyStore.remove(removed.id, removed.sshPublicKey).catch(() => {});
	await removeGitCache(removed.id).catch(() => {});
	return { removed: true };
}

type AllowedRepo = { id: string; provider: RepoProvider; repo: string; sshPublicKey: string | null };

async function assertRepoAllowed(db: DbOrTx, projectId: string, provider: RepoProvider, repo: string): Promise<AllowedRepo> {
	const rows = await db
		.select({ id: projectRepo.id, provider: projectRepo.provider, repo: projectRepo.repo, sshPublicKey: projectRepo.sshPublicKey })
		.from(projectRepo)
		.where(and(eq(projectRepo.projectId, projectId), isNull(projectRepo.deletedAt)));
	const hit = rows.find((r) => r.provider === provider && r.repo === repo);
	if (hit) return hit;
	throw new CoreError(
		'REPO_NOT_ALLOWED',
		`A(z) ${repo} repó nincs felvéve a projekt hivatkozható repói közé. A munkatér tulajdonosa veheti fel a Beállításokban.`,
		{ repo, provider, allowed: rows.map((r) => `${r.provider}:${r.repo}`) }
	);
}

/** SSH-kulccsal olvasunk, ha a repóhoz van; különben a szolgáltató API-ján. */
const authFor = (r: AllowedRepo): RepoAuth | undefined => (r.sshPublicKey ? { ssh: { repoId: r.id, publicKey: r.sshPublicKey } } : undefined);

async function fetchOrFail(loc: FileLocation, auth?: RepoAuth): Promise<FetchedFile> {
	try {
		return await repoClient.fetchFile(loc, auth);
	} catch (e) {
		if (e instanceof RepoFetchError) {
			throw new CoreError('REPO_FETCH_FAILED', e.message, { repo: loc.repo, path: loc.path, ref: loc.ref, status: e.status });
		}
		throw e;
	}
}

// ---------------------------------------------------------------- SSH-kulcsok (deploy key)

async function lockLiveRepo(tx: DbOrTx, projectId: string, repoId: string) {
	const [row] = await tx
		.select({ id: projectRepo.id, provider: projectRepo.provider, repo: projectRepo.repo, sshPublicKey: projectRepo.sshPublicKey })
		.from(projectRepo)
		.where(and(eq(projectRepo.id, repoId), eq(projectRepo.projectId, projectId), isNull(projectRepo.deletedAt)))
		.for('update');
	if (!row) throw new CoreError('NOT_FOUND', 'Nincs ilyen hivatkozható repó ebben a projektben.');
	return row;
}

/**
 * Új SSH-kulcs a repóhoz (ha már volt, lecseréli). A nyilvános kulcsot a repó Deploy keys beállításainál
 * kell hozzáadni, írási jog nélkül; onnantól Teréz ezzel olvassa a repót, token nélkül is.
 * A kulcsfájl az adatbázis előtt íródik, így az adatbázis mindig létező kulcsra mutat.
 */
export async function generateRepoKey(db: Db, actor: Actor, input: { projectId: string; repoId: string }) {
	humanOnly(actor, 'A repók SSH-kulcsait');
	const pre = await db.transaction(async (tx) => {
		await loadProject(tx, actor, input.projectId, 'owner');
		return lockLiveRepo(tx, input.projectId, input.repoId);
	});
	const pair = generateSshKey(`terez:${pre.repo}`);
	await keyStore.save(pre.id, pair);
	let old: string | null;
	try {
		old = await db.transaction(async (tx) => {
			const { project: p } = await loadProject(tx, actor, input.projectId, 'owner');
			const row = await lockLiveRepo(tx, p.id, input.repoId);
			await tx
				.update(projectRepo)
				.set({ sshPublicKey: pair.publicKey, sshFingerprint: pair.fingerprint, sshKeyCreatedAt: clock.now(), sshVerifiedAt: null })
				.where(eq(projectRepo.id, row.id));
			await recordEvent(tx, actor, {
				projectId: p.id,
				type: 'project.repo_key_created',
				targetType: 'project',
				targetId: p.id,
				summary: row.sshPublicKey ? `Új SSH-kulcs: ${row.repo} (a régi már nem érvényes)` : `SSH-kulcs készült: ${row.repo}`,
				data: { provider: row.provider, repo: row.repo, fingerprint: pair.fingerprint }
			});
			return row.sshPublicKey;
		});
	} catch (e) {
		await keyStore.remove(pre.id, pair.publicKey).catch(() => {});
		throw e;
	}
	if (old && old !== pair.publicKey) await keyStore.remove(pre.id, old).catch(() => {});
	return { repoId: pre.id, publicKey: pair.publicKey, fingerprint: pair.fingerprint, replaced: !!old };
}

/** A repó SSH-kulcsának törlése; utána újra az API-n (tokennel, ha van) olvas. A kulcsfájl ténylegesen törlődik. */
export async function removeRepoKey(db: Db, actor: Actor, input: { projectId: string; repoId: string }) {
	humanOnly(actor, 'A repók SSH-kulcsait');
	const old = await db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'owner');
		const row = await lockLiveRepo(tx, p.id, input.repoId);
		if (!row.sshPublicKey) throw new CoreError('VALIDATION', 'Ehhez a repóhoz nincs SSH-kulcs.');
		await tx
			.update(projectRepo)
			.set({ sshPublicKey: null, sshFingerprint: null, sshKeyCreatedAt: null, sshVerifiedAt: null })
			.where(eq(projectRepo.id, row.id));
		await recordEvent(tx, actor, {
			projectId: p.id,
			type: 'project.repo_key_removed',
			targetType: 'project',
			targetId: p.id,
			summary: `SSH-kulcs törölve: ${row.repo}`,
			data: { provider: row.provider, repo: row.repo }
		});
		return { id: row.id, publicKey: row.sshPublicKey };
	});
	await keyStore.remove(old.id, old.publicKey).catch(() => {});
	return { removed: true };
}

/** Olvasható-e a repó a kulccsal (a Deploy key hozzáadása után); siker esetén megjegyezzük az időpontot. */
export async function checkRepoAccess(db: Db, actor: Actor, input: { projectId: string; repoId: string }) {
	humanOnly(actor, 'A repók SSH-kulcsait');
	const row = await db.transaction(async (tx) => {
		const { project: p } = await loadProject(tx, actor, input.projectId, 'owner');
		return lockLiveRepo(tx, p.id, input.repoId);
	});
	if (!row.sshPublicKey) throw new CoreError('VALIDATION', 'Ehhez a repóhoz még nincs SSH-kulcs; előbb generálj egyet.');
	let defaultBranch: string;
	try {
		({ defaultBranch } = await repoClient.checkAccess(
			{ provider: row.provider, repo: row.repo },
			{ ssh: { repoId: row.id, publicKey: row.sshPublicKey } }
		));
	} catch (e) {
		if (e instanceof RepoFetchError) throw new CoreError('REPO_FETCH_FAILED', e.message, { repo: row.repo, status: e.status });
		throw e;
	}
	// Csak ha közben nem cserélték a kulcsot.
	await db
		.update(projectRepo)
		.set({ sshVerifiedAt: clock.now() })
		.where(and(eq(projectRepo.id, row.id), eq(projectRepo.sshPublicKey, row.sshPublicKey)));
	return { ok: true, repo: row.repo, defaultBranch };
}

// ---------------------------------------------------------------- hivatkozás

export interface LinkRepoFileInput {
	documentId: string;
	/** `tulajdonos/név`, vagy a repó, illetve a fájl webes címe. */
	repo: string;
	provider?: RepoProvider;
	/** A fájl útvonala; elhagyható, ha a repó címe már egy fájlra mutat. */
	path?: string;
	ref?: string;
	/** Alapból a fájl első `#` címsora, vagy a fájl neve. */
	title?: string;
	afterSectionId?: string | null;
	reason: string;
}

/**
 * Új, csak olvasható szakasz egy engedélyezett repó fájljából. A fájlt a tranzakció előtt
 * olvassuk be (hálózat), a szakaszt és a forrását egy tranzakcióban írjuk.
 */
export async function linkRepoFile(db: Db, actor: Actor, input: LinkRepoFileInput) {
	const reason = requireReason(input.reason);
	const parsed = parseRepoInput(input.repo, input.provider);
	const loc: FileLocation = {
		provider: parsed.provider,
		repo: parsed.repo,
		path: normalizePath(input.path?.trim() ? input.path : parsed.path),
		ref: normalizeRef(input.ref ?? parsed.ref)
	};
	const pre = await loadDocument(db, actor, input.documentId, 'editor');
	assertDirectWriteAllowed(actor, pre.document);
	const allowed = await assertRepoAllowed(db, pre.project.id, loc.provider, loc.repo);

	const file = await fetchOrFail(loc, authFor(allowed));
	const conv = fileToSection(file.text, { ...loc, ref: loc.ref ?? file.ref });
	const title = input.title?.trim() || conv.title;

	return db.transaction(async (tx) => {
		const ctx = await loadDocument(tx, actor, input.documentId, 'editor');
		assertDirectWriteAllowed(actor, ctx.document);
		await assertRepoAllowed(tx, ctx.project.id, loc.provider, loc.repo);
		const created = await createSectionTx(
			tx,
			actor,
			{ documentId: input.documentId, title, content: conv.content, afterSectionId: input.afterSectionId ?? null, reason },
			undefined,
			undefined,
			{
				summary: `Új szakasz a repóból: „${title}” (${sourceLabel({ repo: loc.repo, path: loc.path, ref: loc.ref })})`,
				data: { source: { provider: loc.provider, repo: loc.repo, path: loc.path, ref: loc.ref ?? null } }
			}
		);
		const now = clock.now();
		const [src] = await tx
			.insert(sectionSource)
			.values({
				sectionId: created.sectionId,
				provider: loc.provider,
				repo: loc.repo,
				path: loc.path,
				ref: loc.ref ?? null,
				blobSha: file.blobSha,
				webUrl: file.webUrl,
				createdBy: actor.userId,
				checkedAt: now,
				syncedAt: now
			})
			.returning();
		return { sectionId: created.sectionId, revision: created.revision, title, source: sourceView(src) };
	});
}

// ---------------------------------------------------------------- frissítés

export type RefreshMode = 'explicit' | 'auto';

export interface RefreshResult {
	sectionId: string;
	changed: boolean;
	revision?: number;
	/** Automatikus módban: a gyorsítótár még friss volt, nem kérdeztük meg a repót. */
	fresh?: boolean;
	/** Automatikus módban: nem sikerült frissíteni (a szakasz a régi tartalommal marad). */
	error?: string;
}

async function recordFailure(db: Db, sectionId: string, message: string) {
	await db.update(sectionSource).set({ lastError: message, checkedAt: clock.now() }).where(eq(sectionSource.sectionId, sectionId));
}

/**
 * Repóhivatkozású szakasz frissítése. Ha a fájl tartalma változott, új `sync` revízió és
 * `section.synced` esemény keletkezik, a hivatkozás létrehozójának nevében.
 *
 * - `explicit` (gomb, `refresh_section`): szerkesztő kell, mindig megkérdezi a repót, és hiba esetén dob.
 * - `auto` (olvasáskor): olvasónak is fut, csak ha lejárt a gyorsítótár; hibát nem dob, csak rögzít.
 */
export async function refreshRepoSection(
	db: Db,
	actor: Actor,
	input: { sectionId: string },
	mode: RefreshMode = 'explicit'
): Promise<RefreshResult> {
	const role = mode === 'explicit' ? 'editor' : 'viewer';
	const ctx0 = await loadSection(db, actor, input.sectionId, role);
	const [src] = await db.select().from(sectionSource).where(eq(sectionSource.sectionId, input.sectionId));
	if (!src) {
		if (mode === 'auto') return { sectionId: input.sectionId, changed: false };
		throw new CoreError('VALIDATION', 'Ez a szakasz nem repóból jön, nincs mit frissíteni.');
	}
	if (ctx0.section.deletedAt) {
		if (mode === 'auto') return { sectionId: input.sectionId, changed: false };
		throw new CoreError('IN_TRASH', 'A szakasz a lomtárban van; előbb hozd vissza.');
	}
	if (mode === 'auto' && clock.now().getTime() - src.checkedAt.getTime() < repoSyncTtlMs()) {
		return { sectionId: input.sectionId, changed: false, fresh: true };
	}

	let allowed: AllowedRepo;
	try {
		allowed = await assertRepoAllowed(db, ctx0.project.id, src.provider, src.repo);
	} catch (e) {
		if (e instanceof CoreError) {
			await recordFailure(db, src.sectionId, 'A repó már nincs felvéve a projekt hivatkozható repói közé, ezért nem frissül.');
			if (mode === 'auto') return { sectionId: input.sectionId, changed: false, error: e.message };
		}
		throw e;
	}

	let file: FetchedFile;
	try {
		file = await fetchOrFail({ provider: src.provider, repo: src.repo, path: src.path, ref: src.ref ?? undefined }, authFor(allowed));
	} catch (e) {
		if (e instanceof CoreError) {
			await recordFailure(db, src.sectionId, e.message);
			if (mode === 'auto') return { sectionId: input.sectionId, changed: false, error: e.message };
		}
		throw e;
	}
	const conv = fileToSection(file.text, { provider: src.provider, repo: src.repo, path: src.path, ref: src.ref ?? file.ref });

	return db.transaction(async (tx) => {
		const ctx = await loadSection(tx, actor, input.sectionId, role, { forUpdate: true });
		const [cur] = await tx.select().from(sectionSource).where(eq(sectionSource.sectionId, input.sectionId)).for('update');
		const now = clock.now();
		if (!cur || ctx.section.deletedAt || ctx.section.content === conv.content) {
			await tx
				.update(sectionSource)
				.set({ blobSha: file.blobSha, webUrl: file.webUrl, checkedAt: now, lastError: null })
				.where(eq(sectionSource.sectionId, input.sectionId));
			return { sectionId: input.sectionId, changed: false, revision: ctx.section.revision };
		}
		const author: Actor = { userId: cur.createdBy, kind: 'human' };
		const sha7 = file.blobSha.slice(0, 7);
		const res = await writeRevision(tx, ctx, author, {
			title: ctx.section.title,
			content: conv.content,
			kind: 'sync',
			reason: `Frissítés a repóból: ${sourceLabel(cur)} (${sha7})`
		});
		await tx
			.update(sectionSource)
			.set({ blobSha: file.blobSha, webUrl: file.webUrl, checkedAt: now, syncedAt: now, lastError: null })
			.where(eq(sectionSource.sectionId, input.sectionId));
		await recordEvent(tx, author, {
			projectId: ctx.project.id,
			type: 'section.synced',
			targetType: 'section',
			targetId: ctx.section.id,
			summary: `Frissült a repóból: „${ctx.section.title}” (${cur.path}, ${sha7})`,
			data: { documentId: ctx.document.id, revision: res.revision, blobSha: file.blobSha }
		});
		return { sectionId: input.sectionId, changed: true, revision: res.revision };
	});
}

/**
 * Olvasás előtt: a dokumentum (vagy a megadott szakaszok) lejárt gyorsítótárú repóhivatkozásait
 * frissíti, legfeljebb négyet egyszerre. Soha nem dob: a hibát a forrás `lastError`-ja őrzi.
 */
export async function refreshStaleRepoSections(
	db: Db,
	actor: Actor,
	scope: { documentId?: string; sectionIds?: string[] }
) {
	const conds = [isNull(section.deletedAt), lt(sectionSource.checkedAt, new Date(clock.now().getTime() - repoSyncTtlMs()))];
	const where = [];
	if (scope.documentId) where.push(eq(section.documentId, scope.documentId));
	if (scope.sectionIds?.length) where.push(inArray(section.id, scope.sectionIds));
	if (!where.length) return { refreshed: 0, changed: 0 };
	const stale = await db
		.select({ id: sectionSource.sectionId })
		.from(sectionSource)
		.innerJoin(section, eq(section.id, sectionSource.sectionId))
		.where(and(...conds, ...where));
	let changed = 0;
	const queue = stale.map((s) => s.id);
	const worker = async () => {
		for (let id = queue.shift(); id; id = queue.shift()) {
			try {
				const r = await refreshRepoSection(db, actor, { sectionId: id }, 'auto');
				if (r.changed) changed++;
			} catch (e) {
				// Jogosultsági vagy váratlan hiba: az olvasás ettől még menjen tovább.
				if (!(e instanceof CoreError)) console.error('[repo] frissítési hiba', e);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
	return { refreshed: stale.length, changed };
}
