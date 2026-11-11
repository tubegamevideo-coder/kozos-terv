import { afterAll, beforeEach } from 'vitest';
import { createDb, type Db } from '../src/lib/server/db/index';
import { user } from '../src/lib/server/db/schema';
import {
	clock,
	createDocument,
	createProject,
	createSection,
	createWorkspace,
	setMember,
	CoreError,
	type Actor,
	type CoreErrorCode
} from '../src/lib/server/core';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/kozos_terv_test';

/** Közös kapcsolat a tesztfájlhoz; a párhuzamos teszteknek több kapcsolat kell. */
export function useDb(): { db: Db } {
	const { db, client } = createDb(url, { max: 20 });
	const realNow = clock.now;
	beforeEach(async () => {
		clock.now = realNow;
		await client.unsafe(`
			truncate table oauth_token, oauth_code, oauth_client, session, event, project_visit, idea_vote, idea, comment, question, proposal,
			section_lock, section_revision, section, document, project, invitation,
			workspace_member, workspace, "user" restart identity cascade`);
	});
	afterAll(async () => {
		clock.now = realNow;
		await client.end();
	});
	return { db };
}

export async function makeUser(db: Db, name: string) {
	const [u] = await db
		.insert(user)
		.values({ name, email: `${name.toLowerCase()}@example.test` })
		.returning();
	return u;
}

export const human = (userId: string): Actor => ({ userId, kind: 'human' });
export const claude = (userId: string): Actor => ({ userId, kind: 'claude' });

/**
 * Alapállapot: Levente (tulajdonos), Kolléga (szerkesztő), Vendég (olvasó), Idegen (nem tag);
 * egy projekt egy szabad jegyzettel és egy védett fő tervvel, mindkettőben egy szakasszal.
 */
export async function seed(db: Db) {
	const levente = await makeUser(db, 'Levente');
	const kollega = await makeUser(db, 'Kollega');
	const vendeg = await makeUser(db, 'Vendeg');
	const idegen = await makeUser(db, 'Idegen');
	const ws = await createWorkspace(db, human(levente.id), { name: 'Fabak', slug: 'fabak' });
	await setMember(db, human(levente.id), { workspaceId: ws.id, userId: kollega.id, role: 'editor' });
	await setMember(db, human(levente.id), { workspaceId: ws.id, userId: vendeg.id, role: 'viewer' });
	const project = await createProject(db, human(levente.id), {
		workspaceId: ws.id,
		name: 'Pályázatfigyelő',
		goal: 'Pályázatok életciklusának követése'
	});
	const note = await createDocument(db, human(levente.id), { projectId: project.id, title: 'Jegyzetek', kind: 'note' });
	const plan = await createDocument(db, human(levente.id), { projectId: project.id, title: 'Fő terv', kind: 'main_plan' });
	const noteSec = await createSection(db, human(levente.id), {
		documentId: note.id,
		title: 'Ötletek',
		content: 'Első sor.\nMásodik sor.\nHarmadik sor.',
		reason: 'kezdés'
	});
	const planSec = await createSection(db, human(levente.id), {
		documentId: plan.id,
		title: 'Cél',
		content: 'A pályázatfigyelő célja: értesíteni.',
		reason: 'kezdés'
	});
	return { levente, kollega, vendeg, idegen, ws, project, note, plan, noteSec, planSec };
}

/** Elvárja, hogy a hívás adott kódú CoreError-ral bukjon, és visszaadja a hibát. */
export async function expectCoreError(p: Promise<unknown>, code: CoreErrorCode): Promise<CoreError> {
	try {
		await p;
	} catch (e) {
		if (e instanceof CoreError && e.code === code) return e;
		throw new Error(`Várt ${code}, kapott: ${e instanceof CoreError ? e.code : String(e)}`);
	}
	throw new Error(`Várt ${code}, de a hívás sikerült.`);
}

export const minutesFromNow = (m: number) => {
	const t = Date.now() + m * 60_000;
	return () => new Date(t);
};
