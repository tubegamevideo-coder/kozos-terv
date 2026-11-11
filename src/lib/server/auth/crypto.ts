import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Kriptográfiailag erős, URL-biztos véletlen token (256 bit). */
export const randomToken = (prefix = '') => prefix + randomBytes(32).toString('base64url');

/** A tokeneket csak hash-elve tároljuk; elég a SHA-256, mert a token maga 256 bit entrópia. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

export function safeEqual(a: string, b: string) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)) === code_challenge */
export function verifyPkce(verifier: string, challenge: string) {
	if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
	return safeEqual(sha256(verifier), challenge);
}
