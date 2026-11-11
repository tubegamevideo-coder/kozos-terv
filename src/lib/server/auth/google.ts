import { randomToken, sha256 } from './crypto';
import type { AuthConfig } from './config';

/** A Google-belépés átmeneti állapota (sütiben, 10 percig): CSRF-állapot, PKCE és a visszatérési cím. */
export interface GoogleFlowState {
	state: string;
	verifier: string;
	next: string;
}

export const GOOGLE_FLOW_COOKIE = 'kt_google_flow';

export function startGoogleLogin(cfg: AuthConfig, next: string) {
	const flow: GoogleFlowState = { state: randomToken(), verifier: randomToken(), next: safeNext(next) };
	const url = new URL(cfg.google.authorizeUrl);
	url.search = new URLSearchParams({
		client_id: cfg.google.clientId,
		redirect_uri: `${cfg.origin}/api/auth/callback/google`,
		response_type: 'code',
		scope: 'openid email profile',
		state: flow.state,
		code_challenge: sha256(flow.verifier),
		code_challenge_method: 'S256',
		prompt: 'select_account'
	}).toString();
	return { url: url.toString(), flow };
}

export interface GoogleProfile {
	email: string;
	emailVerified: boolean;
	name: string;
	picture: string | null;
}

/** Kódcsere és a felhasználói adatok lekérése a Google-tól (a userinfo végpont a hiteles forrás). */
export async function finishGoogleLogin(
	cfg: AuthConfig,
	code: string,
	flow: GoogleFlowState,
	fetchImpl: typeof fetch = fetch
): Promise<GoogleProfile> {
	const tokenRes = await fetchImpl(cfg.google.tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: cfg.google.clientId,
			client_secret: cfg.google.clientSecret,
			redirect_uri: `${cfg.origin}/api/auth/callback/google`,
			code_verifier: flow.verifier
		})
	});
	if (!tokenRes.ok) throw new Error(`Google token: ${tokenRes.status} ${await tokenRes.text()}`);
	const { access_token } = (await tokenRes.json()) as { access_token?: string };
	if (!access_token) throw new Error('Google token: nincs access_token');
	const infoRes = await fetchImpl(cfg.google.userinfoUrl, { headers: { authorization: `Bearer ${access_token}` } });
	if (!infoRes.ok) throw new Error(`Google userinfo: ${infoRes.status}`);
	const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string; picture?: string };
	if (!info.email) throw new Error('Google userinfo: nincs e-mail');
	return {
		email: info.email.toLowerCase(),
		emailVerified: info.email_verified === true,
		name: info.name ?? info.email,
		picture: info.picture ?? null
	};
}

/** Csak saját, relatív címre engedünk visszairányítani (nyílt átirányítás ellen). */
export function safeNext(next: string | null | undefined) {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
	return next;
}
