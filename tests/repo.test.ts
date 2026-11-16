import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
	addProjectRepo,
	clock,
	editSection,
	getChanges,
	getProjectBrief,
	linkRepoFile,
	listProjectRepos,
	listRevisions,
	lockSection,
	proposeChange,
	readDocument,
	readSection,
	refreshRepoSection,
	refreshStaleRepoSections,
	removeProjectRepo,
	replaceSection,
	restoreRevision,
	searchProject,
	trashSection
} from '../src/lib/server/core';
import { buildMcpServer } from '../src/lib/server/mcp/server';
import { repoClient, RepoFetchError, type FileLocation } from '../src/lib/server/repo/client';
import { fileToSection } from '../src/lib/server/repo/content';
import { normalizePath, parseRepoInput } from '../src/lib/server/repo/ref';
import type { Db } from '../src/lib/server/db';
import { claude, expectCoreError, human, minutesFromNow, seed, useDb } from './helpers';

const { db } = useDb();

// ------------------------------------------------------------ hamis repó (hálózat nélkül)

const files = new Map<string, { text: string; sha: string }>();
const calls: FileLocation[] = [];
let failWith: RepoFetchError | null = null;
const realFetch = repoClient.fetchFile;

beforeEach(() => {
	files.clear();
	calls.length = 0;
	failWith = null;
	repoClient.fetchFile = async (loc) => {
		calls.push(loc);
		if (failWith) throw failWith;
		const f = files.get(`${loc.provider}:${loc.repo}:${loc.path}`);
		if (!f) throw new RepoFetchError('A fájl nem található (GitHub), vagy a szerver tokenje nem fér hozzá.', 404);
		return { text: f.text, blobSha: f.sha, webUrl: `https://github.com/${loc.repo}/blob/${loc.ref ?? 'main'}/${loc.path}`, ref: loc.ref };
	};
});
afterEach(() => {
	repoClient.fetchFile = realFetch;
});

const REPO = 'fabak/palyazat';
const put = (path: string, text: string, sha: string) => files.set(`github:${REPO}:${path}`, { text, sha: sha.padEnd(40, sha) });

async function linked(db: Db) {
	const s = await seed(db);
	await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: REPO });
	put('docs/architektura.md', '# Architektúra\n\nKözpont és példányok.', 'a');
	const sec = await linkRepoFile(db, human(s.kollega.id), {
		documentId: s.note.id,
		repo: REPO,
		path: 'docs/architektura.md',
		reason: 'a rendszerterv a repóban él'
	});
	return { ...s, sec };
}

// ------------------------------------------------------------ címek és tartalom

describe('repócím és fájltartalom', () => {
	it('rövid alak, GitHub-, GitLab- és raw-cím; rossz útvonal és ismeretlen cím hibát ad', () => {
		expect(parseRepoInput('Fabak/Palyazat')).toEqual({ provider: 'github', repo: 'fabak/palyazat' });
		expect(parseRepoInput('https://github.com/Fabak/palyazat/blob/main/docs/architektura.md')).toEqual({
			provider: 'github',
			repo: 'fabak/palyazat',
			ref: 'main',
			path: 'docs/architektura.md'
		});
		expect(parseRepoInput('https://gitlab.com/fabak/csapat/palyazat/-/blob/develop/docs/a.md')).toEqual({
			provider: 'gitlab',
			repo: 'fabak/csapat/palyazat',
			ref: 'develop',
			path: 'docs/a.md'
		});
		expect(parseRepoInput('https://raw.githubusercontent.com/o/r/main/x.md')).toEqual({ provider: 'github', repo: 'o/r', ref: 'main', path: 'x.md' });
		expect(parseRepoInput('fabak/csapat/palyazat', 'gitlab')).toEqual({ provider: 'gitlab', repo: 'fabak/csapat/palyazat' });
		expect(() => parseRepoInput('https://example.com/x/y')).toThrowError(/Ismeretlen repócím/);
		expect(() => parseRepoInput('csak-egy-szo')).toThrowError(/Nem értelmezhető GitHub-repó/);
		expect(normalizePath('/docs//a.md')).toBe('docs/a.md');
		expect(() => normalizePath('docs/../../titok.md')).toThrowError(/Érvénytelen fájlútvonal/);
	});

	it('Markdown: az első címsor lesz a cím, a front matter elmarad, a relatív linkek a repóra mutatnak, a kódblokk érintetlen', () => {
		const md = [
			'---',
			'title: x',
			'---',
			'# Architektúra',
			'',
			'Lásd [adatmodell](./adatmodell.md#entitasok), [ADR](../adr/0001.md "döntés"), ![ábra](img/flow.png), [külső](https://x.hu), [horgony](#lent).',
			'',
			'```md',
			'[nem](relativ.md)',
			'```',
			'',
			'[gyoker]: /README.md'
		].join('\n');
		const r = fileToSection(md, { provider: 'github', repo: REPO, path: 'docs/architecture.md' });
		expect(r.title).toBe('Architektúra');
		expect(r.content.startsWith('Lásd')).toBe(true);
		expect(r.content).not.toContain('title: x');
		expect(r.content).toContain('[adatmodell](https://github.com/fabak/palyazat/blob/HEAD/docs/adatmodell.md#entitasok)');
		expect(r.content).toContain('[ADR](https://github.com/fabak/palyazat/blob/HEAD/adr/0001.md "döntés")');
		expect(r.content).toContain('![ábra](https://github.com/fabak/palyazat/raw/HEAD/docs/img/flow.png)');
		expect(r.content).toContain('[külső](https://x.hu)');
		expect(r.content).toContain('[horgony](#lent)');
		expect(r.content).toContain('[nem](relativ.md)');
		expect(r.content).toContain('[gyoker]: https://github.com/fabak/palyazat/blob/HEAD/README.md');

		const gl = fileToSection('[a](b.md)', { provider: 'gitlab', repo: 'fabak/csapat/palyazat', path: 'docs/x.md', ref: 'main' });
		expect(gl.title).toBe('x');
		expect(gl.content).toBe('[a](https://gitlab.com/fabak/csapat/palyazat/-/blob/main/docs/b.md)');
	});

	it('más szöveges fájl kódblokkban (elég hosszú kerítéssel), a .mmd Mermaid-ábraként', () => {
		const sql = fileToSection('create table x();\n-- ```\n', { provider: 'github', repo: REPO, path: 'db/schema.sql' });
		expect(sql.title).toBe('schema.sql');
		expect(sql.content).toBe('````sql\ncreate table x();\n-- ```\n````');
		const mmd = fileToSection('flowchart LR\nA-->B', { provider: 'github', repo: REPO, path: 'docs/folyamat.mmd' });
		expect(mmd.content).toBe('```mermaid\nflowchart LR\nA-->B\n```');
	});
});

// ------------------------------------------------------------ GitHub/GitLab-olvasó (hamis fetch-csel)

describe('repóolvasó', () => {
	const realGlobalFetch = globalThis.fetch;
	const savedEnv = { ...process.env };
	afterEach(() => {
		globalThis.fetch = realGlobalFetch;
		for (const k of ['GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_URL']) {
			if (savedEnv[k] === undefined) delete process.env[k];
			else process.env[k] = savedEnv[k];
		}
	});
	const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
	/** A GitHub 60 karakterenként tör a base64-ben. */
	const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/(.{60})/g, '$1\n');

	it('GitHub: base64-tartalom, blob SHA, webes cím, token a fejlécben; a hibák magyarul', async () => {
		process.env.GITHUB_TOKEN = 'teszt-token';
		const seen: { url: string; auth: string | null }[] = [];
		let next = () => reply(200, { type: 'file', encoding: 'base64', size: 30, sha: 'abc123def456', content: b64('# Cím\n\nÁrvíztűrő tükörfúrógép, '.repeat(3)), html_url: 'https://github.com/o/r/blob/main/docs/a%20b.md' });
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
			return next();
		}) as typeof fetch;
		const loc = { provider: 'github' as const, repo: 'o/r', path: 'docs/a b.md', ref: 'main' };

		const f = await realFetch(loc);
		expect(f).toEqual({ text: '# Cím\n\nÁrvíztűrő tükörfúrógép, '.repeat(3), blobSha: 'abc123def456', webUrl: 'https://github.com/o/r/blob/main/docs/a%20b.md', ref: 'main' });
		expect(seen[0]).toEqual({ url: 'https://api.github.com/repos/o/r/contents/docs/a%20b.md?ref=main', auth: 'Bearer teszt-token' });

		next = () => reply(200, [{ type: 'file', name: 'a.md' }]);
		await expect(realFetch(loc)).rejects.toThrow(/mappa/);
		next = () => reply(404, { message: 'Not Found' });
		await expect(realFetch(loc)).rejects.toThrow('A fájl nem található (GitHub), vagy a szerver tokenje nem fér hozzá.');
		next = () => reply(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
		await expect(realFetch(loc)).rejects.toThrow(/lekérdezési kerete/);
		next = () => reply(200, { type: 'file', encoding: 'base64', size: 3, sha: 'x', content: b64(Buffer.from([0x89, 0x00, 0x01])) });
		await expect(realFetch(loc)).rejects.toThrow(/bináris/);
		next = () => reply(200, { type: 'file', encoding: 'none', size: 2_000_000, sha: 'x', content: '' });
		await expect(realFetch(loc)).rejects.toThrow(/túl nagy/);

		delete process.env.GITHUB_TOKEN;
		next = () => reply(404, { message: 'Not Found' });
		await expect(realFetch(loc)).rejects.toThrow(/nincs hozzá token \(GITHUB_TOKEN\) vagy SSH-kulcs/);
		expect(seen.at(-1)?.auth).toBeNull();
		globalThis.fetch = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof fetch;
		await expect(realFetch(loc)).rejects.toThrow(/nem érhető el/);
	});

	it('GitLab: alapértelmezett ág feloldása, saját szerver, private-token fejléc', async () => {
		process.env.GITLAB_TOKEN = 'gl-token';
		process.env.GITLAB_URL = 'https://git.ceg.hu/';
		const seen: string[] = [];
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			seen.push(String(url));
			expect(new Headers(init?.headers).get('private-token')).toBe('gl-token');
			if (String(url).endsWith('/projects/csapat%2Falcsoport%2Fapp')) return reply(200, { default_branch: 'fo' });
			return reply(200, { encoding: 'base64', size: 5, blob_id: 'b10b', content: b64('hello') });
		}) as typeof fetch;

		const f = await realFetch({ provider: 'gitlab', repo: 'csapat/alcsoport/app', path: 'docs/x y.md' });
		expect(seen).toEqual([
			'https://git.ceg.hu/api/v4/projects/csapat%2Falcsoport%2Fapp',
			'https://git.ceg.hu/api/v4/projects/csapat%2Falcsoport%2Fapp/repository/files/docs%2Fx%20y.md?ref=fo'
		]);
		expect(f).toEqual({ text: 'hello', blobSha: 'b10b', webUrl: 'https://git.ceg.hu/csapat/alcsoport/app/-/blob/fo/docs/x%20y.md', ref: 'fo' });
		// saját szerver címe is felismerhető
		expect(parseRepoInput('https://git.ceg.hu/csapat/app/-/blob/fo/README.md')).toEqual({ provider: 'gitlab', repo: 'csapat/app', ref: 'fo', path: 'README.md' });
	});
});

// ------------------------------------------------------------ mag

describe('hivatkozható repók', () => {
	it('csak felvett repóból lehet hivatkozni; repót csak a tulajdonos vehet fel, emberként', async () => {
		const s = await seed(db);
		put('docs/architektura.md', '# Architektúra\n\nKözpont és példányok.', 'a');
		const input = { documentId: s.note.id, repo: REPO, path: 'docs/architektura.md', reason: 'terv' };
		const notAllowed = await expectCoreError(linkRepoFile(db, human(s.kollega.id), input), 'REPO_NOT_ALLOWED');
		expect(notAllowed.details.allowed).toEqual([]);
		expect(calls).toHaveLength(0);

		await expectCoreError(addProjectRepo(db, human(s.kollega.id), { projectId: s.project.id, repo: REPO }), 'FORBIDDEN');
		await expectCoreError(addProjectRepo(db, claude(s.levente.id), { projectId: s.project.id, repo: REPO }), 'HUMAN_ONLY');
		const added = await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: 'https://github.com/Fabak/Palyazat' });
		expect(added).toMatchObject({ provider: 'github', repo: REPO, added: true });
		expect((await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: REPO })).added).toBe(false);
		expect(await listProjectRepos(db, human(s.vendeg.id), s.project.id)).toMatchObject([{ provider: 'github', repo: REPO, addedBy: 'Levente' }]);

		const sec = await linkRepoFile(db, claude(s.kollega.id), input);
		expect(sec).toMatchObject({ revision: 1, title: 'Architektúra', source: { repo: REPO, path: 'docs/architektura.md', readOnly: true } });
		const read = await readSection(db, human(s.levente.id), sec.sectionId);
		expect(read.content).toBe('Központ és példányok.');
		expect(read.source).toMatchObject({ provider: 'github', repo: REPO, blobSha: 'aaaaaaa', lastError: null });

		const { items } = await getChanges(db, human(s.levente.id), { projectId: s.project.id });
		expect(items.find((e) => e.type === 'section.created' && e.targetId === sec.sectionId)).toMatchObject({
			via: 'claude',
			summary: expect.stringContaining('repóból'),
			data: { source: { provider: 'github', repo: REPO, path: 'docs/architektura.md' } }
		});
		// a védett fő tervbe a Claude itt sem írhat közvetlenül
		await expectCoreError(linkRepoFile(db, claude(s.kollega.id), { ...input, documentId: s.plan.id }), 'PROTECTED_DOCUMENT');
	});

	it('nem létező fájlnál olvasható hiba, és nem jön létre szakasz', async () => {
		const s = await seed(db);
		await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: REPO });
		const e = await expectCoreError(
			linkRepoFile(db, human(s.kollega.id), { documentId: s.note.id, repo: REPO, path: 'docs/nincs.md', reason: 'x' }),
			'REPO_FETCH_FAILED'
		);
		expect(e.message).toContain('nem található');
		const doc = await readDocument(db, human(s.levente.id), { documentId: s.note.id });
		expect(doc.sections.map((x) => x.title)).toEqual(['Ötletek']);
	});
});

describe('repóhivatkozású szakasz', () => {
	it('csak olvasható: szerkesztés, csere, javaslat, zár, visszaállítás REPO_LINKED; lomtárba tehető és visszahozható', async () => {
		const s = await linked(db);
		const id = s.sec.sectionId;
		const e = await expectCoreError(
			editSection(db, human(s.levente.id), { sectionId: id, baseRevision: 1, oldText: 'Központ', newText: 'X', reason: 'r' }),
			'REPO_LINKED'
		);
		expect(e.message).toContain('https://github.com/fabak/palyazat/blob/main/docs/architektura.md');
		expect(e.details.source).toMatchObject({ repo: REPO, path: 'docs/architektura.md' });
		await expectCoreError(replaceSection(db, claude(s.kollega.id), { sectionId: id, baseRevision: 1, content: 'új', reason: 'r' }), 'REPO_LINKED');
		await expectCoreError(proposeChange(db, claude(s.kollega.id), { sectionId: id, baseRevision: 1, content: 'új', reason: 'r' }), 'REPO_LINKED');
		await expectCoreError(lockSection(db, claude(s.kollega.id), { sectionId: id, purpose: 'átírás' }), 'REPO_LINKED');
		await expectCoreError(restoreRevision(db, human(s.levente.id), { sectionId: id, baseRevision: 1, toRevision: 1, reason: 'r' }), 'REPO_LINKED');

		const t = await trashSection(db, human(s.kollega.id), { sectionId: id, baseRevision: 1, reason: 'nem kell' });
		expect(t.revision).toBe(2);
		const back = await restoreRevision(db, human(s.levente.id), { sectionId: id, baseRevision: 2, toRevision: 1, reason: 'mégis kell' });
		expect(back.revision).toBe(3);
		expect((await readSection(db, human(s.levente.id), id)).inTrash).toBe(false);
	});

	it('frissítés: változatlan fájlnál nincs új revízió; változásnál sync-revízió a hivatkozó nevében, eseménnyel, kereshetően', async () => {
		const s = await linked(db);
		const id = s.sec.sectionId;
		expect(await refreshRepoSection(db, human(s.levente.id), { sectionId: id })).toMatchObject({ changed: false, revision: 1 });

		put('docs/architektura.md', '# Architektúra\n\nKözpont, példányok és adatcsomag-szolgáltatás.', 'b');
		expect(await refreshRepoSection(db, human(s.levente.id), { sectionId: id })).toMatchObject({ changed: true, revision: 2 });
		const revs = await listRevisions(db, human(s.levente.id), id);
		expect(revs[0]).toMatchObject({ revision: 2, kind: 'sync', by: 'Kollega', via: 'human' });
		expect(revs[0].reason).toContain('docs/architektura.md');
		const read = await readSection(db, human(s.vendeg.id), id);
		expect(read).toMatchObject({ title: 'Architektúra', content: 'Központ, példányok és adatcsomag-szolgáltatás.', revision: 2 });
		expect(read.source?.blobSha).toBe('bbbbbbb');

		const { items } = await getChanges(db, human(s.levente.id), { projectId: s.project.id });
		expect(items.at(-1)).toMatchObject({ type: 'section.synced', byUserId: s.kollega.id, targetId: id });
		const found = await searchProject(db, human(s.vendeg.id), { projectId: s.project.id, query: 'adatcsomag' });
		expect(found.sections.map((x) => x.sectionId)).toEqual([id]);
	});

	it('olvasáskor csak lejárt gyorsítótárnál frissül; hibánál a régi tartalom marad, és a hiba látszik', async () => {
		const s = await linked(db);
		const id = s.sec.sectionId;
		put('docs/architektura.md', '# Architektúra\n\nÚj változat.', 'c');

		expect(await refreshStaleRepoSections(db, human(s.vendeg.id), { documentId: s.note.id })).toEqual({ refreshed: 0, changed: 0 });
		clock.now = minutesFromNow(6);
		expect(await refreshStaleRepoSections(db, human(s.vendeg.id), { documentId: s.note.id })).toEqual({ refreshed: 1, changed: 1 });
		expect((await readSection(db, human(s.vendeg.id), id)).content).toBe('Új változat.');

		failWith = new RepoFetchError('A(z) GitHub most nem érhető el (hálózati hiba vagy időtúllépés). Később újra próbálható.');
		clock.now = minutesFromNow(12);
		expect(await refreshStaleRepoSections(db, human(s.vendeg.id), { sectionIds: [id] })).toEqual({ refreshed: 1, changed: 0 });
		const read = await readSection(db, human(s.vendeg.id), id);
		expect(read.content).toBe('Új változat.');
		expect(read.source?.lastError).toContain('nem érhető el');

		await expectCoreError(refreshRepoSection(db, human(s.kollega.id), { sectionId: id }), 'REPO_FETCH_FAILED');
		await expectCoreError(refreshRepoSection(db, human(s.vendeg.id), { sectionId: id }), 'FORBIDDEN');
		failWith = null;
		await refreshRepoSection(db, human(s.kollega.id), { sectionId: id });
		expect((await readSection(db, human(s.vendeg.id), id)).source?.lastError).toBeNull();
	});

	it('kivett repó: a szakasz megmarad, de nem frissül; az összefoglaló mutatja a forrást', async () => {
		const s = await linked(db);
		const id = s.sec.sectionId;
		let brief = await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		expect(brief.linkableRepos).toEqual([`github:${REPO}`]);
		expect(brief.documents[0].sections.find((x) => x.id === id)).toMatchObject({ fromRepo: `${REPO}/docs/architektura.md` });

		const [r] = await listProjectRepos(db, human(s.levente.id), s.project.id);
		await expectCoreError(removeProjectRepo(db, human(s.kollega.id), { projectId: s.project.id, repoId: r.id }), 'FORBIDDEN');
		await removeProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repoId: r.id });
		await expectCoreError(refreshRepoSection(db, human(s.kollega.id), { sectionId: id }), 'REPO_NOT_ALLOWED');
		brief = await getProjectBrief(db, claude(s.kollega.id), { projectId: s.project.id });
		expect(brief.linkableRepos).toEqual([]);
		const doc = await readDocument(db, human(s.levente.id), { documentId: s.note.id, full: true });
		expect(doc.sections.find((x) => x.id === id)).toMatchObject({ content: 'Központ és példányok.', source: { lastError: expect.stringContaining('nincs felvéve') } });
	});
});

// ------------------------------------------------------------ MCP

async function connect(db: Db, userId: string) {
	const server = buildMcpServer(db, claude(userId));
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'teszt', version: '1' });
	await Promise.all([server.connect(a), client.connect(b)]);
	return async (name: string, args: Record<string, unknown> = {}) => {
		const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
		return { isError: !!r.isError, text: r.content.map((c) => c.text).join('\n') };
	};
}

describe('repóhivatkozás MCP-n', () => {
	it('link_repo_file → read_section forrással → edit_section REPO_LINKED → refresh_section', async () => {
		const s = await seed(db);
		await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: REPO });
		put('docs/adatmodell.md', '# Adatmodell\n\nFelhívás, feltétel, pályázat.', 'd');
		const call = await connect(db, s.kollega.id);

		const link = await call('link_repo_file', {
			documentId: s.note.id,
			repo: `https://github.com/${REPO}/blob/main/docs/adatmodell.md`,
			reason: 'az adatmodell a repóban él'
		});
		expect(link.isError).toBe(false);
		const { sectionId, title } = JSON.parse(link.text);
		expect(title).toBe('Adatmodell');
		expect(calls.at(-1)).toMatchObject({ repo: REPO, path: 'docs/adatmodell.md', ref: 'main' });

		const read = await call('read_section', { sectionId });
		expect(read.text).toContain('REPÓBÓL');
		expect(read.text).toContain('Felhívás, feltétel, pályázat.');

		const edit = await call('edit_section', { sectionId, baseRevision: 1, oldText: 'Felhívás', newText: 'X', reason: 'r' });
		expect(edit.isError).toBe(true);
		expect(edit.text).toContain('HIBA REPO_LINKED');

		put('docs/adatmodell.md', '# Adatmodell\n\nFelhívás, feltétel, pályázat, tervezet.', 'e');
		const refreshed = await call('refresh_section', { sectionId });
		expect(JSON.parse(refreshed.text)).toMatchObject({ changed: true, revision: 2 });

		const notAllowed = await call('link_repo_file', { documentId: s.note.id, repo: 'mas/repo', path: 'a.md', reason: 'r' });
		expect(notAllowed.text).toContain('HIBA REPO_NOT_ALLOWED');
	});
});
