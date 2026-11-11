import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthConfig } from '../../../lib/server/auth/config';
import { GOOGLE_FLOW_COOKIE, startGoogleLogin } from '../../../lib/server/auth/google';

export const GET: RequestHandler = ({ url, cookies }) => {
	const cfg = getAuthConfig();
	if (!cfg.google.clientId) return new Response('A Google-belépés nincs beállítva (GOOGLE_CLIENT_ID).', { status: 500 });
	const { url: target, flow } = startGoogleLogin(cfg, url.searchParams.get('next') ?? '/');
	cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify(flow), {
		path: '/',
		httpOnly: true,
		secure: cfg.secureCookies,
		sameSite: 'lax',
		maxAge: 600
	});
	redirect(303, target, { external: true });
};
