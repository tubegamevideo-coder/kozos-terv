/**
 * Fejlesztői kezdőadatok (2. lépés, a Google-belépés előtt). Ismételten futtatható.
 *
 *   SEED_USERS="Levente=levente@pelda.hu,Kolléga=kollega@pelda.hu" npm run seed:dev
 *
 * Az első felhasználó a munkatér tulajdonosa, a többiek szerkesztők. Létrehozza:
 *  - a „Fabak” munkateret,
 *  - a „Közös tervezőapp” projektet, benne a docs/SPEC.md-vel védett fő tervként,
 *  - az üres „Pályázatfigyelő” projektet (az első éles próbához).
 */
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/index';
import { project, user, workspace, workspaceMember } from '../src/lib/server/db/schema';
import { createProject, createWorkspace, importMarkdown, setMember, type Actor } from '../src/lib/server/core';

const url = process.env.DATABASE_URL;
const spec = process.env.SEED_USERS;
if (!url || !spec) {
	console.error('Kell: DATABASE_URL és SEED_USERS="Név=email,Név2=email2"');
	process.exit(1);
}

const people = spec.split(',').map((p) => {
	const [name, email] = p.split('=').map((s) => s.trim());
	if (!name || !email) throw new Error(`Hibás SEED_USERS elem: ${p}`);
	return { name, email: email.toLowerCase() };
});

const { db, client } = createDb(url, { max: 2 });

const ids: string[] = [];
for (const p of people) {
	const [existing] = await db.select().from(user).where(eq(user.email, p.email));
	const u = existing ?? (await db.insert(user).values({ name: p.name, email: p.email, emailVerified: true }).returning())[0];
	ids.push(u.id);
	console.log(`${existing ? '✓ megvan' : '+ létrehozva'}: ${u.name} <${u.email}>`);
}
const owner: Actor = { userId: ids[0], kind: 'human' };

let [ws] = await db.select().from(workspace).where(eq(workspace.slug, 'fabak'));
if (!ws) {
	ws = await createWorkspace(db, owner, { name: 'Fabak', slug: 'fabak' });
	console.log('+ munkatér: Fabak');
} else {
	await db
		.insert(workspaceMember)
		.values({ workspaceId: ws.id, userId: ids[0], role: 'owner' })
		.onConflictDoNothing();
}
for (const id of ids.slice(1)) {
	const [m] = await db
		.select()
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, ws.id), eq(workspaceMember.userId, id)));
	if (!m) await setMember(db, owner, { workspaceId: ws.id, userId: id, role: 'editor' });
}

async function ensureProject(name: string, goal: string, instructions: string) {
	const [p] = await db
		.select()
		.from(project)
		.where(and(eq(project.workspaceId, ws.id), eq(project.name, name)));
	if (p) {
		console.log(`✓ projekt megvan: ${name}`);
		return { project: p, created: false };
	}
	console.log(`+ projekt: ${name}`);
	return { project: await createProject(db, owner, { workspaceId: ws.id, name, goal, instructions }), created: true };
}

const app = await ensureProject(
	'Közös tervezőapp',
	'Saját MCP-s tervezőfelület, ahol többen a saját Claude-jukkal terveznek közösen.',
	'Magyarul dolgozunk. A fő terv (Specifikáció) védett: oda csak javaslatot tegyél. A megvalósítás a GitHub-repóban van (tubegamevideo-coder/kozos-terv); ha a terv és a kód eltér, jelezd kérdésként.'
);
if (app.created) {
	const md = await readFile(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
	const r = await importMarkdown(db, owner, {
		projectId: app.project.id,
		markdown: md,
		title: 'Specifikáció',
		kind: 'main_plan'
	});
	console.log(`  + importálva: Specifikáció (${r.sectionIds.length} szakasz)`);
}

await ensureProject(
	'Pályázatfigyelő',
	'Dobozos pályázatkezelő termék a teljes pályázati életciklusra.',
	'Magyarul dolgozunk. Ötleteléskor az ötleteket add_idea-val rögzítsd, a nyitott kérdéseket add_question-nel.'
);

await client.end();
console.log('Kész.');
