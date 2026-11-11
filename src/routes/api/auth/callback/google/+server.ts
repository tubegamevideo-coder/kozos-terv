import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { getAuthConfig } from '../../../../../lib/server/auth/config';
import { finishGoogleLogin, GOOGLE_FLOW_COOKIE, type GoogleFlowState } from '../../../../../lib/server/auth/google';
import { safeEqual } from '../../../../../lib/server/auth/crypto';
import { createSession, SESSION_COOKIE } from '../../../../../lib/server/auth/sessions';
import { resolveLoginUser } from '../../../../../lib/server/core/members';

const fail = (reason: string) => redirect(303, `/login?hiba=${encodeURIComponent(reason)}`);

export const GET: RequestHandler = async ({ url, cookies, request }) => {
	const cfg = getAuthConfig();
	const raw = cookies.get(GOOGLE_FLOW_COOKIE);
	cookies.delete(GOOGLE_FLOW_COOKIE, { path: '/' });
	if (url.searchParams.get('error')) fail('A Google-belépés megszakadt.');
	let flow: GoogleFlowState;
	try {
		flow = JSON.parse(raw ?? '');
	} catch {
		return fail('A belépés lejárt, kezdd újra.');
	}
	const state = url.searchParams.get('state') ?? '';
	const code = url.searchParams.get('code');
	if (!code || !safeEqual(state, flow.state)) fail('Érvénytelen belépési állapot, kezdd újra.');

	let profile;
	try {
		profile = await finishGoogleLogin(cfg, code!, flow);
	} catch (e) {
		console.error('[google]', e);
		return fail('A Google nem igazolta a belépést.');
	}
	if (!profile.emailVerified) fail('A Google-fiók e-mail-címe nincs megerősítve.');

	const db = getDb();
	const u = await resolveLoginUser(db, { email: profile.email, name: profile.name, image: profile.picture });
	if (!u) fail(`A(z) ${profile.email} címnek nincs meghívója. Kérj meghívót a munkatér tulajdonosától.`);

	const s = await createSession(db, u!.id, cfg.sessionTtlSec, request.headers.get('user-agent'));
	cookies.set(SESSION_COOKIE, s.token, {
		path: '/',
		httpOnly: true,
		secure: cfg.secureCookies,
		sameSite: 'lax',
		expires: s.expiresAt
	});
	redirect(303, flow.next);
};
