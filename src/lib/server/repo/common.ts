import type { RepoProvider } from './ref';

export interface FileLocation {
	provider: RepoProvider;
	repo: string;
	path: string;
	ref?: string;
}

export interface FetchedFile {
	text: string;
	/** A tartalom azonosítója (git blob SHA). */
	blobSha: string;
	webUrl: string;
	/** A ténylegesen olvasott ág (GitLabon az alapértelmezett ág feloldva). */
	ref?: string;
}

/** Hogyan olvassuk a repót: alapból a szolgáltató API-ján (token a .env-ben, ha van), vagy SSH-kulccsal. */
export interface RepoAuth {
	/** A projekt repójához generált SSH-kulcs (deploy key); a privát kulcs a szerver adatmappájában van. */
	ssh?: { repoId: string; publicKey: string };
}

/** Legfeljebb ekkora fájlt húzunk be egy szakaszba. */
export const MAX_FILE_BYTES = 256 * 1024;

/** A repó nem adta oda a fájlt; az üzenet magyar, a felületen és a Claude-nak is megjelenik. */
export class RepoFetchError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super(message);
		this.name = 'RepoFetchError';
	}
}

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Szövegként visszaadható-e a fájl: méretkorlát és bináris tartalom ellenőrzése. */
export function decodeText(buf: Buffer, declaredSize?: number) {
	const size = declaredSize ?? buf.length;
	if (size > MAX_FILE_BYTES || buf.length > MAX_FILE_BYTES) {
		throw new RepoFetchError(`A fájl túl nagy (${Math.round(size / 1024)} KB); legfeljebb ${MAX_FILE_BYTES / 1024} KB lehet.`);
	}
	if (buf.includes(0)) throw new RepoFetchError('Ez bináris fájl, szakaszként nem jeleníthető meg.');
	return buf.toString('utf8');
}
