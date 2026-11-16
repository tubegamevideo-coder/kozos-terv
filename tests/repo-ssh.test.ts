import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	addProjectRepo,
	checkRepoAccess,
	generateRepoKey,
	getChanges,
	linkRepoFile,
	listProjectRepos,
	refreshRepoSection,
	removeProjectRepo,
	removeRepoKey
} from '../src/lib/server/core';
import { repoClient, RepoFetchError, type FileLocation, type RepoAuth } from '../src/lib/server/repo/client';
import { normalizeRef } from '../src/lib/server/repo/ref';
import { checkAccessSsh, explainGitError, fetchFileSsh, sshRemote } from '../src/lib/server/repo/ssh';
import { generateSshKey, keyFilePath, keyStore, sshFingerprint } from '../src/lib/server/repo/sshkey';
import { claude, expectCoreError, human, seed, useDb } from './helpers';

const { db } = useDb();

const has = (bin: string) => {
	try {
		execFileSync('which', [bin], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();

const stateDir = mkdtempSync(join(tmpdir(), 'kt-ssh-state-'));
const savedState = process.env.REPO_STATE_DIR;
const realOf = sshRemote.of;
beforeAll(() => {
	process.env.REPO_STATE_DIR = stateDir;
});
afterAll(() => {
	if (savedState === undefined) delete process.env.REPO_STATE_DIR;
	else process.env.REPO_STATE_DIR = savedState;
	sshRemote.of = realOf;
});

/** Forrásrepó a teszthez: main és fejlesztes ág, dokumentum, mappa, bináris és túl nagy fájl. */
function makeSourceRepo() {
	const work = mkdtempSync(join(tmpdir(), 'kt-src-'));
	git(work, 'init', '-q', '-b', 'main');
	git(work, 'config', 'user.email', 't@example.test');
	git(work, 'config', 'user.name', 'Teszt');
	mkdirSync(join(work, 'docs'));
	writeFileSync(join(work, 'docs/architektura.md'), '# Architektúra\n\nKözpont és példányok.\n');
	writeFileSync(join(work, 'docs/kep.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
	writeFileSync(join(work, 'nagy.txt'), 'x'.repeat(300 * 1024));
	git(work, 'add', '-A');
	git(work, 'commit', '-q', '-m', 'kezdés');
	git(work, 'checkout', '-q', '-b', 'fejlesztes');
	writeFileSync(join(work, 'docs/architektura.md'), '# Architektúra\n\nFejlesztés alatt.\n');
	git(work, 'commit', '-q', '-am', 'fejlesztés');
	git(work, 'checkout', '-q', 'main');
	const bare = `${work}.git`;
	execFileSync('git', ['clone', '-q', '--bare', work, bare]);
	git(bare, 'config', 'uploadpack.allowFilter', 'true');
	git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
	return { work, bare };
}

const push = (work: string, file: string, text: string) => {
	writeFileSync(join(work, file), text);
	git(work, 'commit', '-q', '-am', 'módosítás');
	git(work, 'push', '-q', `${work}.git`, 'main');
};

// ------------------------------------------------------------ kulcs

describe('SSH-kulcs', () => {
	it('ed25519 kulcspár OpenSSH-formában, helyes ujjlenyomattal', () => {
		const k = generateSshKey('terez:fabak/palyazat');
		expect(k.publicKey).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+=* terez:fabak\/palyazat$/);
		expect(k.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n$/);
		expect(k.fingerprint).toBe(sshFingerprint(Buffer.from(k.publicKey.split(' ')[1], 'base64')));
		expect(generateSshKey('x').publicKey).not.toBe(k.publicKey);
	});

	it.skipIf(!has('ssh-keygen'))('az ssh-keygen ugyanazt a nyilvános kulcsot és ujjlenyomatot olvassa ki belőle', () => {
		const k = generateSshKey('terez:o/r');
		const file = join(mkdtempSync(join(tmpdir(), 'kt-key-')), 'id');
		writeFileSync(file, k.privateKey, { mode: 0o600 });
		const derived = execFileSync('ssh-keygen', ['-y', '-f', file], { encoding: 'utf8' }).trim();
		expect(derived.split(' ').slice(0, 2)).toEqual(k.publicKey.split(' ').slice(0, 2));
		expect(execFileSync('ssh-keygen', ['-l', '-f', file], { encoding: 'utf8' })).toContain(k.fingerprint);
	});

	it('a kulcsfájl 0600-as, a neve a nyilvános kulcsból jön; kötőjeles ág nem mehet a git parancssorába', async () => {
		const k = generateSshKey('t');
		const file = await keyStore.save('11111111-2222-3333-4444-555555555555', k);
		expect(file).toBe(keyFilePath('11111111-2222-3333-4444-555555555555', k.publicKey));
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(await keyStore.exists('11111111-2222-3333-4444-555555555555', k.publicKey)).toBe(true);
		await keyStore.remove('11111111-2222-3333-4444-555555555555', k.publicKey);
		expect(await keyStore.exists('11111111-2222-3333-4444-555555555555', k.publicKey)).toBe(false);
		expect(() => keyFilePath('../titok', k.publicKey)).toThrow();
		expect(() => normalizeRef('--upload-pack')).toThrowError(/Érvénytelen ág/);
	});

	it('SSH-címek: GitHub, gitlab.com és saját GitLab nem szabványos porttal', () => {
		expect(sshRemote.of('github', 'o/r')).toEqual({ url: 'git@github.com:o/r.git', host: 'github.com' });
		expect(sshRemote.of('gitlab', 'g/s/p')).toEqual({ url: 'git@gitlab.com:g/s/p.git', host: 'gitlab.com' });
		process.env.GITLAB_SSH_HOST = 'git.ceg.hu:2222';
		try {
			expect(sshRemote.of('gitlab', 'g/p')).toEqual({ url: 'ssh://git@git.ceg.hu:2222/g/p.git', host: '[git.ceg.hu]:2222' });
		} finally {
			delete process.env.GITLAB_SSH_HOST;
		}
	});

	it('a git/ssh hibái érthető üzenetté válnak', () => {
		const e = (stderr: string) => explainGitError(Object.assign(new Error('x'), { stderrText: stderr }), { host: 'github.com', ref: 'main' }).message;
		expect(e('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.')).toContain('nem fogadta el');
		expect(e('ERROR: Repository not found.\nfatal: Could not read from remote repository.')).toContain('Deploy keys');
		expect(e("remote: ERROR: The project you were looking for could not be found or you don't have permission to view it.")).toContain('nem található');
		expect(e('Host key verification failed.')).toContain('gépkulcsa nem egyezik');
		expect(e('ssh: Could not resolve hostname github.com: Name or service not known')).toContain('nem érhető el');
		expect(e("fatal: couldn't find remote ref nincs")).toContain('Nincs ilyen ág');
		expect(explainGitError(Object.assign(new Error('x'), { code: 'ENOENT' }), { host: 'h' }).message).toContain('nincs git');
	});
});

// ------------------------------------------------------------ git-olvasó (file:// átvitellel, hálózat nélkül)

describe('git-olvasó', () => {
	const repoId = '22222222-3333-4444-5555-666666666666';
	let src: { work: string; bare: string };
	let key: ReturnType<typeof generateSshKey>;
	beforeAll(async () => {
		src = makeSourceRepo();
		key = generateSshKey('t');
		await keyStore.save(repoId, key);
	});
	beforeEach(() => {
		sshRemote.of = () => ({ url: `file://${src.bare}`, host: 'helyi' });
	});
	afterEach(() => {
		sshRemote.of = realOf;
	});
	const auth = () => ({ repoId, publicKey: key.publicKey });
	const loc = (path: string, ref?: string): FileLocation => ({ provider: 'github', repo: 'fabak/palyazat', path, ref });

	it('alapértelmezett ág, másik ág, és a változás a következő olvasáskor átjön', async () => {
		const f = await fetchFileSsh(loc('docs/architektura.md'), auth());
		expect(f).toEqual({
			text: '# Architektúra\n\nKözpont és példányok.\n',
			blobSha: git(src.bare, 'rev-parse', 'main:docs/architektura.md'),
			webUrl: 'https://github.com/fabak/palyazat/blob/main/docs/architektura.md',
			ref: undefined
		});
		expect((await fetchFileSsh(loc('docs/architektura.md', 'fejlesztes'), auth())).text).toContain('Fejlesztés alatt');
		const gl = await fetchFileSsh({ ...loc('docs/architektura.md'), provider: 'gitlab' }, auth());
		expect(gl.ref).toBe('main');
		expect(gl.webUrl).toBe('https://gitlab.com/fabak/palyazat/-/blob/main/docs/architektura.md');

		push(src.work, 'docs/architektura.md', '# Architektúra\n\nÚj változat.\n');
		const again = await fetchFileSsh(loc('docs/architektura.md'), auth());
		expect(again.text).toContain('Új változat');
		expect(again.blobSha).not.toBe(f.blobSha);
		expect(await checkAccessSsh({ provider: 'github', repo: 'fabak/palyazat' }, auth())).toEqual({ defaultBranch: 'main' });
	});

	it('hiányzó fájl, mappa, bináris, túl nagy fájl, ismeretlen ág, hiányzó kulcs', async () => {
		await expect(fetchFileSsh(loc('docs/nincs.md'), auth())).rejects.toThrow('A fájl nem található a repóban: docs/nincs.md (main).');
		await expect(fetchFileSsh(loc('docs'), auth())).rejects.toThrow(/mappa/);
		await expect(fetchFileSsh(loc('docs/kep.png'), auth())).rejects.toThrow(/bináris/);
		await expect(fetchFileSsh(loc('nagy.txt'), auth())).rejects.toThrow(/túl nagy/);
		await expect(fetchFileSsh(loc('docs/architektura.md', 'nincs-ilyen-ag'), auth())).rejects.toThrow(/Nincs ilyen ág/);
		await expect(fetchFileSsh(loc('docs/architektura.md'), { repoId, publicKey: generateSshKey('más').publicKey })).rejects.toThrow(/hiányzik a szerverről/);
	});

	it('párhuzamos olvasások ugyanabból a repóból sem akadnak össze', async () => {
		const all = await Promise.all([
			fetchFileSsh(loc('docs/architektura.md'), auth()),
			fetchFileSsh(loc('docs/architektura.md', 'fejlesztes'), auth()),
			fetchFileSsh(loc('docs/architektura.md'), auth()),
			fetchFileSsh(loc('docs/architektura.md', 'fejlesztes'), auth())
		]);
		expect(all.map((f) => f.text.includes('Fejlesztés alatt'))).toEqual([false, true, false, true]);
	});
});

// ------------------------------------------------------------ valódi SSH egy helyi sshd-vel (SSH_E2E=1)

const sshd = '/usr/sbin/sshd';
describe.skipIf(process.env.SSH_E2E !== '1' || !existsSync(sshd) || !has('ssh'))('valódi SSH (helyi sshd)', () => {
	const repoId = '33333333-4444-5555-6666-777777777777';
	let server: ChildProcess;
	let port = 0;
	let src: { work: string; bare: string };
	let good: ReturnType<typeof generateSshKey>;
	let dir: string;

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'kt-sshd-'));
		src = makeSourceRepo();
		good = generateSshKey('terez:helyi');
		await keyStore.save(repoId, good);
		execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'host_key')]);
		writeFileSync(join(dir, 'authorized_keys'), `${good.publicKey}\n`, { mode: 0o600 });
		port = await new Promise<number>((resolve) => {
			const s = createServer().listen(0, '127.0.0.1', () => {
				const p = (s.address() as { port: number }).port;
				s.close(() => resolve(p));
			});
		});
		writeFileSync(
			join(dir, 'sshd_config'),
			[
				`Port ${port}`,
				'ListenAddress 127.0.0.1',
				`HostKey ${join(dir, 'host_key')}`,
				`PidFile ${join(dir, 'sshd.pid')}`,
				`AuthorizedKeysFile ${join(dir, 'authorized_keys')}`,
				'PasswordAuthentication no',
				'KbdInteractiveAuthentication no',
				'PubkeyAuthentication yes',
				'StrictModes no',
				'UsePAM no',
				'PermitRootLogin prohibit-password',
				'LogLevel ERROR'
			].join('\n') + '\n'
		);
		mkdirSync('/run/sshd', { recursive: true });
		server = spawn(sshd, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: 'ignore' });
		for (let i = 0; i < 50; i++) {
			const up = await new Promise<boolean>((r) => {
				const sock = connect(port, '127.0.0.1');
				sock.once('connect', () => {
					sock.destroy();
					r(true);
				});
				sock.once('error', () => r(false));
			});
			if (up) break;
			await new Promise((r) => setTimeout(r, 100));
		}
	});
	afterAll(() => server?.kill());
	beforeEach(() => {
		sshRemote.of = () => ({ url: `ssh://${userInfo().username}@127.0.0.1:${port}${src.bare}`, host: `[127.0.0.1]:${port}` });
	});
	afterEach(() => {
		sshRemote.of = realOf;
	});
	const loc: FileLocation = { provider: 'github', repo: 'fabak/palyazat', path: 'docs/architektura.md' };

	it('a generált kulccsal olvas; az ismeretlen gép kulcsát az első kapcsolatkor megjegyzi', async () => {
		const f = await fetchFileSsh(loc, { repoId, publicKey: good.publicKey });
		expect(f.text).toBe('# Architektúra\n\nKözpont és példányok.\n');
		expect(readFileSync(join(stateDir, 'ssh', 'known_hosts'), 'utf8')).toContain(`[127.0.0.1]:${port}`);
		expect(await checkAccessSsh(loc, { repoId, publicKey: good.publicKey })).toEqual({ defaultBranch: 'main' });
	});

	it('ismeretlen kulccsal és megváltozott gépkulccsal érthető hiba', async () => {
		const other = generateSshKey('más');
		await keyStore.save(repoId, other);
		await expect(fetchFileSsh(loc, { repoId, publicKey: other.publicKey })).rejects.toThrow(/nem fogadta el Teréz SSH-kulcsát/);

		const kh = join(stateDir, 'ssh', 'known_hosts');
		const fake = generateSshKey('hamis').publicKey.split(' ').slice(0, 2).join(' ');
		writeFileSync(kh, `[127.0.0.1]:${port} ${fake}\n`);
		await expect(fetchFileSsh(loc, { repoId, publicKey: good.publicKey })).rejects.toThrow(/gépkulcsa nem egyezik/);
		writeFileSync(kh, '');
	});
});

// ------------------------------------------------------------ mag: kulcs a projekt repójához

describe('repó SSH-kulccsal', () => {
	const realFetch = repoClient.fetchFile;
	const realCheck = repoClient.checkAccess;
	const seen: (RepoAuth | undefined)[] = [];
	let checkFails: RepoFetchError | null = null;
	beforeEach(() => {
		seen.length = 0;
		checkFails = null;
		repoClient.fetchFile = async (l: FileLocation, auth?: RepoAuth) => {
			seen.push(auth);
			return { text: '# Terv\n\nTartalom.', blobSha: 'a'.repeat(40), webUrl: `https://github.com/${l.repo}/blob/main/${l.path}`, ref: l.ref };
		};
		repoClient.checkAccess = async () => {
			if (checkFails) throw checkFails;
			return { defaultBranch: 'main' };
		};
	});
	afterEach(() => {
		repoClient.fetchFile = realFetch;
		repoClient.checkAccess = realCheck;
	});

	it('kulcsot csak a tulajdonos generálhat; a nyilvános kulcs látszik, a privát fájlban marad', async () => {
		const s = await seed(db);
		const { id: repoId } = await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: 'fabak/palyazat' });
		const input = { projectId: s.project.id, repoId };
		await expectCoreError(generateRepoKey(db, human(s.kollega.id), input), 'FORBIDDEN');
		await expectCoreError(generateRepoKey(db, claude(s.levente.id), input), 'HUMAN_ONLY');

		const k = await generateRepoKey(db, human(s.levente.id), input);
		expect(k).toMatchObject({ repoId, replaced: false, publicKey: expect.stringMatching(/^ssh-ed25519 \S+ terez:fabak\/palyazat$/) });
		const [listed] = await listProjectRepos(db, human(s.vendeg.id), s.project.id);
		expect(listed).toMatchObject({ sshPublicKey: k.publicKey, sshFingerprint: k.fingerprint, sshVerifiedAt: null });
		expect(JSON.stringify(listed)).not.toContain('PRIVATE KEY');
		expect(readFileSync(keyFilePath(repoId, k.publicKey), 'utf8')).toContain('BEGIN OPENSSH PRIVATE KEY');
		const { items } = await getChanges(db, human(s.levente.id), { projectId: s.project.id });
		expect(items.at(-1)).toMatchObject({ type: 'project.repo_key_created', summary: 'SSH-kulcs készült: fabak/palyazat' });

		// Csere: az új kulcs él, a régi fájl törlődik, az ellenőrzés újra kell.
		await checkRepoAccess(db, human(s.levente.id), input);
		const k2 = await generateRepoKey(db, human(s.levente.id), input);
		expect(k2.replaced).toBe(true);
		expect(await keyStore.exists(repoId, k.publicKey)).toBe(false);
		expect(await keyStore.exists(repoId, k2.publicKey)).toBe(true);
		expect((await listProjectRepos(db, human(s.levente.id), s.project.id))[0]).toMatchObject({ sshPublicKey: k2.publicKey, sshVerifiedAt: null });
	});

	it('kulccsal SSH-n olvas, kulcs nélkül az API-n; az ellenőrzés eredménye megmarad', async () => {
		const s = await seed(db);
		const { id: repoId } = await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: 'fabak/palyazat' });
		const input = { projectId: s.project.id, repoId };
		const link = { documentId: s.note.id, repo: 'fabak/palyazat', path: 'docs/terv.md', reason: 'terv' };

		const a = await linkRepoFile(db, human(s.kollega.id), link);
		expect(seen.at(-1)).toBeUndefined();

		await expectCoreError(checkRepoAccess(db, human(s.levente.id), input), 'VALIDATION');
		const k = await generateRepoKey(db, human(s.levente.id), input);
		await refreshRepoSection(db, human(s.kollega.id), { sectionId: a.sectionId });
		expect(seen.at(-1)).toEqual({ ssh: { repoId, publicKey: k.publicKey } });

		checkFails = new RepoFetchError('A repó nem fogadta el Teréz SSH-kulcsát.', 403);
		const e = await expectCoreError(checkRepoAccess(db, human(s.levente.id), input), 'REPO_FETCH_FAILED');
		expect(e.message).toContain('nem fogadta el');
		checkFails = null;
		expect(await checkRepoAccess(db, human(s.levente.id), input)).toMatchObject({ ok: true, defaultBranch: 'main' });
		expect((await listProjectRepos(db, human(s.levente.id), s.project.id))[0].sshVerifiedAt).toBeInstanceOf(Date);

		await removeRepoKey(db, human(s.levente.id), input);
		expect(await keyStore.exists(repoId, k.publicKey)).toBe(false);
		await refreshRepoSection(db, human(s.kollega.id), { sectionId: a.sectionId });
		expect(seen.at(-1)).toBeUndefined();
		await expectCoreError(removeRepoKey(db, human(s.levente.id), input), 'VALIDATION');
	});

	it('a repó kivételekor a kulcsfájl is törlődik', async () => {
		const s = await seed(db);
		const { id: repoId } = await addProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repo: 'fabak/palyazat' });
		const k = await generateRepoKey(db, human(s.levente.id), { projectId: s.project.id, repoId });
		await removeProjectRepo(db, human(s.levente.id), { projectId: s.project.id, repoId });
		expect(await keyStore.exists(repoId, k.publicKey)).toBe(false);
		await expectCoreError(generateRepoKey(db, human(s.levente.id), { projectId: s.project.id, repoId }), 'NOT_FOUND');
	});
});
