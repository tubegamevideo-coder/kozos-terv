import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '../../lib/server/db/client';
import { deleteSession, SESSION_COOKIE } from '../../lib/server/auth/sessions';
import { safeNext } from '../../lib/server/auth/google';

/** Kilépés; `next` mezővel a belépés után oda tér vissza (pl. fiókváltás az engedélyező oldalon). */
export const POST: RequestHandler = async ({ cookies, request }) => {
	const form = await request.formData().catch(() => null);
	const next = safeNext(form?.get('next')?.toString());
	await deleteSession(getDb(), cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
};
