import { decodeText, encodePath, MAX_FILE_BYTES, RepoFetchError, type FetchedFile, type FileLocation, type RepoAuth } from './common';
import { gitlabBase, type RepoProvider } from './ref';
import { checkAccessSsh, fetchFileSsh } from './ssh';

export { MAX_FILE_BYTES, RepoFetchError, type FetchedFile, type FileLocation, type RepoAuth };

const TIMEOUT_MS = 10_000;

async function get(url: string, headers: Record<string, string>, provider: string, hasToken: boolean) {
	let res: Response;
	try {
		res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch {
		throw new RepoFetchError(`A(z) ${provider} most nem érhető el (hálózati hiba vagy időtúllépés). Később újra próbálható.`);
	}
	if (res.ok) return res.json() as Promise<Record<string, unknown>>;
	const tokenHint = hasToken
		? 'a szerver tokenje nem fér hozzá'
		: `a repó privát, és nincs hozzá token (${provider === 'GitHub' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN'}) vagy SSH-kulcs (Beállítások → Repók)`;
	if (res.status === 404) throw new RepoFetchError(`A fájl nem található (${provider}), vagy ${tokenHint}.`, 404);
	if (res.status === 401) throw new RepoFetchError(`A(z) ${provider}-token érvénytelen vagy lejárt.`, 401);
	if (res.status === 403 || res.status === 429) {
		const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429;
		throw new RepoFetchError(
			limited
				? `Elfogyott a(z) ${provider} lekérdezési kerete; később újra próbálható${hasToken ? '' : ' (tokennel vagy SSH-kulccsal nincs ilyen korlát)'}.`
				: `Nincs hozzáférés a repóhoz (${provider}, 403): ${tokenHint}.`,
			res.status
		);
	}
	throw new RepoFetchError(`A(z) ${provider} hibát adott (HTTP ${res.status}).`, res.status);
}

async function fetchGitHub(loc: FileLocation): Promise<FetchedFile> {
	const token = process.env.GITHUB_TOKEN?.trim();
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'kozos-terv'
	};
	if (token) headers.authorization = `Bearer ${token}`;
	const q = loc.ref ? `?ref=${encodeURIComponent(loc.ref)}` : '';
	const j = await get(`https://api.github.com/repos/${loc.repo}/contents/${encodePath(loc.path)}${q}`, headers, 'GitHub', !!token);
	if (Array.isArray(j) || j.type !== 'file') throw new RepoFetchError('Ez mappa, nem fájl: egy konkrét fájlt adj meg.');
	if (j.encoding !== 'base64' || typeof j.content !== 'string') {
		throw new RepoFetchError(`A fájl túl nagy; legfeljebb ${MAX_FILE_BYTES / 1024} KB lehet.`);
	}
	return {
		text: decodeText(Buffer.from(j.content, 'base64'), typeof j.size === 'number' ? j.size : undefined),
		blobSha: String(j.sha),
		webUrl: String(j.html_url ?? `https://github.com/${loc.repo}/blob/${loc.ref ?? 'HEAD'}/${encodePath(loc.path)}`),
		ref: loc.ref
	};
}

async function fetchGitLab(loc: FileLocation): Promise<FetchedFile> {
	const base = gitlabBase();
	const token = process.env.GITLAB_TOKEN?.trim();
	const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'kozos-terv' };
	if (token) headers['private-token'] = token;
	const project = `${base}/api/v4/projects/${encodeURIComponent(loc.repo)}`;
	let ref = loc.ref;
	if (!ref) {
		const p = await get(project, headers, 'GitLab', !!token);
		if (typeof p.default_branch !== 'string') throw new RepoFetchError('A GitLab-projektnek nincs alapértelmezett ága; add meg az ágat.');
		ref = p.default_branch;
	}
	const j = await get(`${project}/repository/files/${encodeURIComponent(loc.path)}?ref=${encodeURIComponent(ref)}`, headers, 'GitLab', !!token);
	if (j.encoding !== 'base64' || typeof j.content !== 'string') throw new RepoFetchError('A GitLab ismeretlen formában adta vissza a fájlt.');
	return {
		text: decodeText(Buffer.from(j.content, 'base64'), typeof j.size === 'number' ? j.size : undefined),
		blobSha: String(j.blob_id),
		webUrl: `${base}/${loc.repo}/-/blob/${encodePath(ref)}/${encodePath(loc.path)}`,
		ref
	};
}

/**
 * A repóolvasó. SSH-kulccsal git-tel olvas, különben a szolgáltató API-ján (token a .env-ben, ha van).
 * A tesztek a függvényeit lecserélik (mint a `clock.now`-t), így nem kell hálózat.
 */
export const repoClient = {
	fetchFile: (loc: FileLocation, auth?: RepoAuth): Promise<FetchedFile> =>
		auth?.ssh ? fetchFileSsh(loc, auth.ssh) : loc.provider === 'github' ? fetchGitHub(loc) : fetchGitLab(loc),
	/** Olvasható-e a repó a kulccsal; visszaadja az alapértelmezett ágat. */
	checkAccess: (loc: { provider: RepoProvider; repo: string }, auth: Required<RepoAuth>): Promise<{ defaultBranch: string }> =>
		checkAccessSsh(loc, auth.ssh)
};

/** Be van-e állítva token az egyes szolgáltatókhoz (a beállítási oldal mutatja). */
export const repoTokens = () => ({ github: !!process.env.GITHUB_TOKEN?.trim(), gitlab: !!process.env.GITLAB_TOKEN?.trim() });
