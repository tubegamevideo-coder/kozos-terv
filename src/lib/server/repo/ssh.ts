import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeText, encodePath, MAX_FILE_BYTES, RepoFetchError, type FetchedFile, type FileLocation } from './common';
import { gitlabBase, type RepoProvider } from './ref';
import { keyFilePath, keyStore, repoStateDir } from './sshkey';

/**
 * Repóolvasás git-tel, SSH-n, a projekt repójához generált kulccsal (deploy key).
 * A gyorsítótár repónként egy „részleges” bare klón: csak a fák jönnek le, a fájl tartalma
 * (blob) akkor, amikor kell. Hálózati hívás, ezért sosem fut adatbázis-tranzakción belül.
 */

/** A github.com és a gitlab.com közzétett ed25519 gépkulcsa; ezekhez szigorúan ragaszkodunk. */
export const PINNED_HOST_KEYS: Record<string, string> = {
	'github.com': 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
	'gitlab.com': 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquxvt6CM6tdG4SLp1Btn/nOeHHE5UOzRdf'
};

const FETCH_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 10_000;

export interface SshRemote {
	url: string;
	/** A gép neve, ahogy a known_hosts tartalmazza (nem szabványos portnál `[gép]:port`). */
	host: string;
}

/** A repó SSH-címe. Saját GitLab-szervernél a gép a GITLAB_SSH_HOST-ból (`gép` vagy `gép:port`) vagy a GITLAB_URL-ből jön. A tesztek lecserélik. */
export const sshRemote = {
	of(provider: RepoProvider, repo: string): SshRemote {
		if (provider === 'github') return { url: `git@github.com:${repo}.git`, host: 'github.com' };
		const hostPort = process.env.GITLAB_SSH_HOST?.trim() || new URL(gitlabBase()).hostname;
		const [host, port] = hostPort.split(':');
		return port && port !== '22'
			? { url: `ssh://git@${host}:${port}/${repo}.git`, host: `[${host}]:${port}` }
			: { url: `git@${host}:${repo}.git`, host };
	}
};

export const gitCacheDir = (repoId: string) => join(repoStateDir(), 'git', repoId);

// ---------------------------------------------------------------- git futtatása

type GitError = Error & { code?: string | number; killed?: boolean; signal?: string; stderrText?: string };

function runGit(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, maxBuffer = 4 * 1024 * 1024) {
	return new Promise<Buffer>((resolve, reject) => {
		execFile('git', args, { env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, encoding: 'buffer' }, (err, stdout, stderr) => {
			if (err) reject(Object.assign(err as GitError, { stderrText: stderr?.toString('utf8') ?? '' }));
			else resolve(stdout);
		});
	});
}

const DENIED =
	'A repó nem fogadta el Teréz SSH-kulcsát. Add hozzá a nyilvános kulcsot a repó Deploy keys beállításainál (írási jog nélkül), majd a Beállításokban ellenőrizd.';

/** A git/ssh hibakimenetéből érthető, magyar üzenet. */
export function explainGitError(e: unknown, ctx: { host: string; ref?: string }): RepoFetchError {
	if (e instanceof RepoFetchError) return e;
	const err = e as GitError;
	if (err.code === 'ENOENT') return new RepoFetchError('A szerveren nincs git vagy ssh telepítve (a Docker-képben benne van; frissítsd az appot).');
	if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new RepoFetchError(`A fájl túl nagy; legfeljebb ${MAX_FILE_BYTES / 1024} KB lehet.`);
	if (err.killed || err.signal === 'SIGKILL') return new RepoFetchError(`A(z) ${ctx.host} nem válaszolt időben (SSH). Később újra próbálható.`);
	const s = err.stderrText ?? '';
	if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key .* (does not match|mismatch)/i.test(s)) {
		return new RepoFetchError(`A(z) ${ctx.host} SSH-gépkulcsa nem egyezik a várttal, ezért biztonsági okból megszakítottam a kapcsolatot.`);
	}
	if (/Permission denied \(publickey/i.test(s)) return new RepoFetchError(DENIED, 403);
	if (/Repository not found|could not be found or you don't have permission|does not appear to be a git repository|not a git repository/i.test(s)) {
		return new RepoFetchError('A repó nem található, vagy Teréz SSH-kulcsa nincs hozzáadva a repó Deploy keys beállításainál.', 404);
	}
	if (/Could not resolve hostname|Connection timed out|Connection refused|Network is unreachable|No route to host|Operation timed out|kex_exchange_identification|Connection closed by/i.test(s)) {
		return new RepoFetchError(`A(z) ${ctx.host} most nem érhető el SSH-n (hálózati hiba vagy időtúllépés). Később újra próbálható.`);
	}
	if (/couldn't find remote ref|not our ref|unadvertised object|invalid refspec/i.test(s)) {
		return new RepoFetchError(`Nincs ilyen ág, címke vagy commit a repóban: ${ctx.ref ?? '?'}.`, 404);
	}
	const last = s.trim().split('\n').filter(Boolean).pop();
	return new RepoFetchError(`A git hibát adott${last ? `: ${last.replace(/^(fatal|error): /, '')}` : '.'}`);
}

// ---------------------------------------------------------------- környezet, gyorsítótár

/** Fájl írása csak akkor, ha a tartalma eltér; átnevezéssel, hogy egy párhuzamos ssh se lásson félig írt fájlt. */
async function ensureFile(path: string, content: string) {
	try {
		if ((await readFile(path, 'utf8')) === content) return;
	} catch {
		/* még nincs */
	}
	const tmp = `${path}.${randomBytes(4).toString('hex')}`;
	await writeFile(tmp, content, { mode: 0o600 });
	await rename(tmp, path);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function gitEnv(host: string, keyPath: string): Promise<NodeJS.ProcessEnv> {
	const sshDir = join(repoStateDir(), 'ssh');
	await mkdir(sshDir, { recursive: true, mode: 0o700 });
	const pinned = host in PINNED_HOST_KEYS;
	let knownHosts = join(sshDir, 'known_hosts');
	if (pinned) {
		knownHosts = join(sshDir, 'known_hosts.pinned');
		await ensureFile(knownHosts, Object.entries(PINNED_HOST_KEYS).map(([h, k]) => `${h} ${k}\n`).join(''));
	}
	const ssh = [
		'ssh -F /dev/null',
		`-i ${shellQuote(keyPath)}`,
		'-o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10',
		`-o UserKnownHostsFile=${shellQuote(knownHosts)} -o GlobalKnownHostsFile=/dev/null`,
		// A github.com és a gitlab.com kulcsa rögzített; más gépnél (saját GitLab) az első kapcsolatkor megjegyezzük.
		`-o StrictHostKeyChecking=${pinned ? 'yes' : 'accept-new'}`
	].join(' ');
	return {
		PATH: process.env.PATH,
		HOME: repoStateDir(),
		LANG: 'C',
		LC_ALL: 'C',
		GIT_TERMINAL_PROMPT: '0',
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_SSH_COMMAND: ssh
	};
}

/** Egy gyorsítótár-mappán egyszerre egy git-művelet fusson (a párhuzamos frissítések ugyanazt a repót is érinthetik). */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
	queues.set(key, run);
	void run.finally(() => {
		if (queues.get(key) === run) queues.delete(key);
	}).catch(() => {});
	return run;
}

async function ensureCache(dir: string, url: string, env: NodeJS.ProcessEnv) {
	try {
		await stat(join(dir, 'HEAD'));
	} catch {
		await mkdir(dir, { recursive: true });
		await runGit(['init', '--bare', '-q', dir], env, LOCAL_TIMEOUT_MS);
		const settings: [string, string][] = [
			['core.repositoryformatversion', '1'],
			['extensions.partialClone', 'origin'],
			['remote.origin.promisor', 'true'],
			['remote.origin.partialCloneFilter', 'blob:none']
		];
		for (const [k, v] of settings) await runGit(['-C', dir, 'config', k, v], env, LOCAL_TIMEOUT_MS);
	}
	await runGit(['-C', dir, 'config', 'remote.origin.url', url], env, LOCAL_TIMEOUT_MS);
}

async function defaultBranch(dir: string, env: NodeJS.ProcessEnv) {
	const out = (await runGit(['-C', dir, 'ls-remote', '--symref', 'origin', 'HEAD'], env, FETCH_TIMEOUT_MS)).toString('utf8');
	const m = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(out);
	if (!m) throw new RepoFetchError('A repó üres, vagy nincs alapértelmezett ága; add meg az ágat.');
	return m[1];
}

async function lsTree(dir: string, env: NodeJS.ProcessEnv, path: string) {
	const out = (await runGit(['--literal-pathspecs', '-C', dir, 'ls-tree', '-z', 'FETCH_HEAD', '--', path], env, LOCAL_TIMEOUT_MS)).toString('utf8');
	for (const rec of out.split('\0')) {
		const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(rec);
		if (m && m[4] === path) return { type: m[2], sha: m[3] };
	}
	return null;
}

async function prepare(loc: { provider: RepoProvider; repo: string }, auth: { repoId: string; publicKey: string }) {
	if (!(await keyStore.exists(auth.repoId, auth.publicKey))) {
		throw new RepoFetchError('A repó SSH-kulcsa hiányzik a szerverről (például költözés után). Generálj új kulcsot a Beállítások → Repók részen.');
	}
	const remote = sshRemote.of(loc.provider, loc.repo);
	const env = await gitEnv(remote.host, keyFilePath(auth.repoId, auth.publicKey));
	return { remote, env, dir: gitCacheDir(auth.repoId) };
}

// ---------------------------------------------------------------- olvasás

/** Egy fájl a repóból SSH-n (a szolgáltató API-ja helyett). */
export async function fetchFileSsh(loc: FileLocation, auth: { repoId: string; publicKey: string }): Promise<FetchedFile> {
	const { remote, env, dir } = await prepare(loc, auth);
	return serialized(dir, async () => {
		try {
			await ensureCache(dir, remote.url, env);
			const ref = loc.ref ?? (await defaultBranch(dir, env));
			await runGit(['-C', dir, 'fetch', '-q', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', ref], env, FETCH_TIMEOUT_MS);
			const entry = await lsTree(dir, env, loc.path);
			if (!entry) throw new RepoFetchError(`A fájl nem található a repóban: ${loc.path} (${ref}).`, 404);
			if (entry.type !== 'blob') throw new RepoFetchError('Ez mappa, nem fájl: egy konkrét fájlt adj meg.');
			// A tartalom itt jön le (részleges klón); a korlát fölötti fájlt a git-kimenet mérete állítja meg.
			const buf = await runGit(['-C', dir, 'cat-file', 'blob', entry.sha], env, FETCH_TIMEOUT_MS, MAX_FILE_BYTES);
			const web =
				loc.provider === 'github'
					? `https://github.com/${loc.repo}/blob/${encodePath(ref)}/${encodePath(loc.path)}`
					: `${gitlabBase()}/${loc.repo}/-/blob/${encodePath(ref)}/${encodePath(loc.path)}`;
			// GitHubon az API-hoz hasonlóan ág nélkül hagyjuk a hivatkozásokat (HEAD), GitLabon a feloldott ággal.
			return { text: decodeText(buf), blobSha: entry.sha, webUrl: web, ref: loc.provider === 'github' ? loc.ref : ref };
		} catch (e) {
			throw explainGitError(e, { host: remote.host, ref: loc.ref });
		}
	});
}

/** Olvasható-e a repó a kulccsal (a Beállítások „Ellenőrzés” gombja). */
export async function checkAccessSsh(loc: { provider: RepoProvider; repo: string }, auth: { repoId: string; publicKey: string }) {
	const { remote, env, dir } = await prepare(loc, auth);
	return serialized(dir, async () => {
		try {
			await ensureCache(dir, remote.url, env);
			return { defaultBranch: await defaultBranch(dir, env) };
		} catch (e) {
			throw explainGitError(e, { host: remote.host });
		}
	});
}

/** A repó gyorsítótárának törlése (a repó kivételekor). */
export const removeGitCache = (repoId: string) => rm(gitCacheDir(repoId), { recursive: true, force: true });
