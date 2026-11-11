import type { Db } from '../db';
import type { AuthConfig } from './config';
import {
	CORS,
	OAuthError,
	authServerMetadata,
	exchangeToken,
	json,
	protectedResourceMetadata,
	registerClient,
	revokeToken
} from './oauth';

/** Az OAuth-végpontok Request → Response formában, hogy SvelteKit nélkül is tesztelhetők legyenek. */
export const oauthEndpoints = (db: Db, cfg: AuthConfig) => ({
	options: () => new Response(null, { status: 204, headers: CORS }),
	authServerMetadata: () => json(authServerMetadata(cfg), 200, { 'cache-control': 'public, max-age=3600' }),
	protectedResourceMetadata: () => json(protectedResourceMetadata(cfg), 200, { 'cache-control': 'public, max-age=3600' }),
	register: async (request: Request) => {
		try {
			const body = await request.json().catch(() => {
				throw new OAuthError('invalid_client_metadata', 'A törzs nem érvényes JSON.');
			});
			return json(await registerClient(db, body), 201);
		} catch (e) {
			return asOAuthResponse(e);
		}
	},
	token: async (request: Request) => {
		try {
			return json(await exchangeToken(db, cfg, request));
		} catch (e) {
			return asOAuthResponse(e);
		}
	},
	revoke: async (request: Request) => {
		try {
			await revokeToken(db, request);
			return new Response(null, { status: 200, headers: CORS });
		} catch (e) {
			return asOAuthResponse(e);
		}
	}
});

function asOAuthResponse(e: unknown) {
	if (e instanceof OAuthError) {
		return e.toResponse(e.status === 401 ? { 'www-authenticate': 'Basic realm="kozos-terv"' } : {});
	}
	console.error('[oauth] váratlan hiba', e);
	return json({ error: 'server_error', error_description: 'Váratlan szerverhiba.' }, 500);
}
