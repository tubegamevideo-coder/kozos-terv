import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '../../lib/server/db/client';
import { deleteSession, SESSION_COOKIE } from '../../lib/server/auth/sessions';

export const POST: RequestHandler = async ({ cookies }) => {
	await deleteSession(getDb(), cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/login');
};
