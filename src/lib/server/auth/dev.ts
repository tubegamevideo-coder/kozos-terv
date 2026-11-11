import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { user } from '../db/schema';
import type { Actor } from '../core';

/**
 * Fejlesztői belépés az MCP-hez (2. lépés, OAuth előtt): statikus Bearer-tokenek,
 * mindegyik egy felhasználó e-mail-címéhez kötve. Formátum: `token1=email1,token2=email2`.
 * Éles, nyilvános címen NEM használható – ott az OAuth jön (3. lépés).
 */
export function parseDevTokens(spec: string | undefined) {
	const map = new Map<string, string>();
	for (const pair of (spec ?? '').split(',')) {
		const [token, email] = pair.split('=').map((s) => s?.trim());
		if (!token || !email) continue;
		if (token.length < 24) throw new Error('MCP_DEV_TOKENS: minden token legalább 24 karakter legyen.');
		map.set(token, email.toLowerCase());
	}
	return map;
}

const safeEqual = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

export function bearerToken(request: Request) {
	const h = request.headers.get('authorization') ?? '';
	const m = h.match(/^Bearer\s+(.+)$/i);
	return m ? m[1].trim() : null;
}

export function devActorResolver(db: Db, tokens: Map<string, string>) {
	return async (request: Request): Promise<Actor | null> => {
		const token = bearerToken(request);
		if (!token) return null;
		let email: string | undefined;
		for (const [t, e] of tokens) if (safeEqual(t, token)) email = e;
		if (!email) return null;
		const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
		return u ? { userId: u.id, kind: 'claude' } : null;
	};
}
