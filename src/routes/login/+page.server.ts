import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { safeNext } from '../../lib/server/auth/google';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	return { next, error: url.searchParams.get('hiba') };
};
