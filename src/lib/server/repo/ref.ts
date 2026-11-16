import { CoreError } from '../core/errors';

export type RepoProvider = 'github' | 'gitlab';

/** Egy repó (és benne opcionálisan egy fájl) helye, normalizálva. */
export interface RepoLocation {
	provider: RepoProvider;
	/** GitHubon `tulajdonos/név`, GitLabon a teljes útvonal; kisbetűsen. */
	repo: string;
	path?: string;
	/** Ág, címke vagy commit; ha nincs, a repó alapértelmezett ága. */
	ref?: string;
}

/** A GitLab címe (saját telepítéshez `GITLAB_URL`), perjel nélkül a végén. */
export function gitlabBase() {
	return (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, '');
}

const GITHUB_REPO = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/;
const GITLAB_REPO = /^[a-z0-9_][a-z0-9._-]*(?:\/[a-z0-9_][a-z0-9._-]*){1,19}$/;
const REF = /^[A-Za-z0-9._\/-]{1,200}$/;

export function normalizeRepo(provider: RepoProvider, input: string) {
	const repo = input
		.trim()
		.replace(/\.git$/i, '')
		.replace(/^\/+|\/+$/g, '')
		.toLowerCase();
	const ok = provider === 'github' ? GITHUB_REPO.test(repo) : GITLAB_REPO.test(repo) && !repo.includes('/-');
	if (!ok) {
		throw new CoreError(
			'VALIDATION',
			provider === 'github'
				? `Nem értelmezhető GitHub-repó: „${input}”. Formátum: tulajdonos/név, vagy a repó webes címe.`
				: `Nem értelmezhető GitLab-repó: „${input}”. Formátum: csoport/projekt, vagy a projekt webes címe.`
		);
	}
	return repo;
}

/** Fájlútvonal a repó gyökeréhez képest; `..` és üres útvonal nem lehet. */
export function normalizePath(input: string | undefined) {
	const parts = (input ?? '')
		.trim()
		.replace(/\\/g, '/')
		.split('/')
		.filter((p) => p !== '' && p !== '.');
	const path = parts.join('/');
	if (!path) throw new CoreError('VALIDATION', 'Add meg a fájl útvonalát a repóban (pl. docs/architektura.md).');
	if (parts.some((p) => p === '..') || path.length > 400 || /[\u0000-\u001f]/.test(path)) {
		throw new CoreError('VALIDATION', `Érvénytelen fájlútvonal: „${input}”.`);
	}
	return path;
}

export function normalizeRef(input: string | undefined | null) {
	const ref = input?.trim();
	if (!ref) return undefined;
	if (!REF.test(ref) || ref.includes('..')) throw new CoreError('VALIDATION', `Érvénytelen ág vagy címke: „${input}”.`);
	return ref;
}

const decode = (s: string) => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

/**
 * Repócím vagy rövid alak értelmezése. Elfogadja:
 * - `tulajdonos/név` (a megadott szolgáltatóval, alapból GitHub),
 * - a repó vagy egy fájl webes címét (`github.com/…/blob/ág/út`, `…/-/blob/ág/út` GitLabon),
 * - `raw.githubusercontent.com/…` címet.
 * Perjelet tartalmazó ágnevet a címből nem lehet biztosan kiolvasni: azt külön (ref) add meg.
 */
export function parseRepoInput(input: string, provider: RepoProvider = 'github'): RepoLocation {
	const raw = input?.trim() ?? '';
	if (!raw) throw new CoreError('VALIDATION', 'Add meg a repót (tulajdonos/név vagy a webes címe).');
	if (!/^https?:\/\//i.test(raw)) return { provider, repo: normalizeRepo(provider, raw) };

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new CoreError('VALIDATION', `Nem értelmezhető cím: „${raw}”.`);
	}
	const host = url.hostname.toLowerCase();
	const seg = url.pathname.split('/').filter(Boolean).map(decode);

	if (host === 'github.com' || host === 'www.github.com') {
		if (seg.length < 2) throw new CoreError('VALIDATION', 'A GitHub-címből hiányzik a tulajdonos és a repó neve.');
		const loc: RepoLocation = { provider: 'github', repo: normalizeRepo('github', `${seg[0]}/${seg[1]}`) };
		if ((seg[2] === 'blob' || seg[2] === 'tree' || seg[2] === 'raw') && seg[3]) {
			loc.ref = seg[3];
			if (seg.length > 4) loc.path = seg.slice(4).join('/');
		}
		return loc;
	}
	if (host === 'raw.githubusercontent.com') {
		if (seg.length < 4) throw new CoreError('VALIDATION', 'A raw-címből hiányzik az ág vagy a fájl.');
		return {
			provider: 'github',
			repo: normalizeRepo('github', `${seg[0]}/${seg[1]}`),
			ref: seg[2],
			path: seg.slice(3).join('/')
		};
	}
	if (host === new URL(gitlabBase()).hostname.toLowerCase()) {
		const dash = seg.indexOf('-');
		const repoSeg = dash === -1 ? seg : seg.slice(0, dash);
		const loc: RepoLocation = { provider: 'gitlab', repo: normalizeRepo('gitlab', repoSeg.join('/')) };
		const rest = dash === -1 ? [] : seg.slice(dash + 1);
		if ((rest[0] === 'blob' || rest[0] === 'tree' || rest[0] === 'raw') && rest[1]) {
			loc.ref = rest[1];
			if (rest.length > 2) loc.path = rest.slice(2).join('/');
		}
		return loc;
	}
	throw new CoreError('VALIDATION', `Ismeretlen repócím: „${raw}”. GitHub- vagy GitLab-cím kell.`);
}

/** Rövid, emberi felirat: `tulajdonos/név/docs/a.md` (ággal, ha meg van adva). */
export const sourceLabel = (s: { repo: string; path: string; ref?: string | null }) =>
	`${s.repo}/${s.path}${s.ref ? ` @ ${s.ref}` : ''}`;
