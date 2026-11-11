import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { authConfigFromEnv } from '../src/lib/server/auth/config';
import { oauthEndpoints } from '../src/lib/server/auth/endpoints';
import {
	approveAuthorization,
	disconnectClient,
	listConnectedClients,
	registerClient,
	resourceMetadataUrl,
	validateAuthorizeRequest,
	verifyAccessToken
} from '../src/lib/server/auth/oauth';
import { bearerToken } from '../src/lib/server/auth/dev';
import { sha256 } from '../src/lib/server/auth/crypto';
import { handleMcpRequest } from '../src/lib/server/mcp/http';
import { inviteMember, readSection, resolveLoginUser, clock } from '../src/lib/server/core';
import type { Db } from '../src/lib/server/db';
import { expectCoreError, human, minutesFromNow, seed, useDb } from './helpers';

const { db } = useDb();
const cfg = authConfigFromEnv({ ORIGIN: 'https://terv.example.test', AUTH_MODE: 'oauth' });
const ORIGIN = cfg.origin;

/** A teljes szerver a teszt fetch-én keresztül: útvonal szerint a megfelelő kezelőhöz. */
function serverFetch(db: Db) {
	const ep = oauthEndpoints(db, cfg);
	const resolveActor = async (r: Request) => {
		const v = await verifyAccessToken(db, cfg, bearerToken(r));
		return v ? { userId: v.userId, kind: 'claude' as const } : null;
	};
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const req = new Request(input, init);
		const path = new URL(req.url).pathname;
		switch (path) {
			case '/.well-known/oauth-protected-resource/mcp':
			case '/.well-known/oauth-protected-resource':
				return ep.protectedResourceMetadata();
			case '/.well-known/oauth-authorization-server':
				return ep.authServerMetadata();
			case '/oauth/register':
				return ep.register(req);
			case '/oauth/token':
				return ep.token(req);
			case '/oauth/revoke':
				return ep.revoke(req);
			case '/mcp':
				return handleMcpRequest(req, { db, resolveActor, resourceMetadataUrl: resourceMetadataUrl(cfg) });
			default:
				return new Response('not found', { status: 404 });
		}
	}) as typeof fetch;
}

/** Egy MCP-kliens (pl. Claude Code) memóriában tartott OAuth-állapottal; a böngészős lépést mi „kattintjuk”. */
function memoryProvider(redirectUrl: string, onAuthorize: (url: URL) => Promise<string>) {
	let info: OAuthClientInformationMixed | undefined;
	let tokens: OAuthTokens | undefined;
	let verifier = '';
	const state = { lastCode: '' };
	const provider: OAuthClientProvider = {
		get redirectUrl() {
			return redirectUrl;
		},
		get clientMetadata() {
			return {
				client_name: 'Teszt Claude',
				redirect_uris: [redirectUrl],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none'
			};
		},
		clientInformation: () => info,
		saveClientInformation: (i) => void (info = i),
		tokens: () => tokens,
		saveTokens: (t) => void (tokens = t),
		redirectToAuthorization: async (url) => {
			state.lastCode = await onAuthorize(url);
		},
		saveCodeVerifier: (v) => void (verifier = v),
		codeVerifier: () => verifier
	};
	return { provider, state, getTokens: () => tokens, getInfo: () => info };
}

describe('belépés meghívóval', () => {
	it('csak tag vagy meghívott léphet be; a meghívó belépéskor beváltódik', async () => {
		const s = await seed(db);
		expect(await resolveLoginUser(db, { email: 'senki@gmail.com', name: 'Senki' })).toBeNull();
		const u = await resolveLoginUser(db, { email: 'LEVENTE@example.test', name: 'L' });
		expect(u?.id).toBe(s.levente.id);

		await expectCoreError(inviteMember(db, human(s.kollega.id), { workspaceId: s.ws.id, email: 'uj@gmail.com', role: 'editor' }), 'FORBIDDEN');
		const inv = await inviteMember(db, human(s.levente.id), { workspaceId: s.ws.id, email: 'Uj@Gmail.com', role: 'editor' });
		expect(inv.status).toBe('invited');
		const nu = await resolveLoginUser(db, { email: 'uj@gmail.com', name: 'Új Tag' });
		expect(nu).toMatchObject({ email: 'uj@gmail.com', name: 'Új Tag' });

		// a meghívó 14 napig él
		await inviteMember(db, human(s.levente.id), { workspaceId: s.ws.id, email: 'kesei@gmail.com', role: 'viewer' });
		clock.now = minutesFromNow(60 * 24 * 15);
		expect(await resolveLoginUser(db, { email: 'kesei@gmail.com', name: 'Késő' })).toBeNull();
	});
});

describe('kliensregisztráció', () => {
	it('https és loopback átirányítás mehet, más nem; titkos kliens titkot kap', async () => {
		await expect(registerClient(db, { redirect_uris: ['http://evil.example.com/cb'] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
		await expect(registerClient(db, { redirect_uris: [] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
		const pub = await registerClient(db, { redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none', client_name: 'Claude Code' });
		expect(pub.client_secret).toBeUndefined();
		const conf = await registerClient(db, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
		expect(conf).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic' });
		expect(conf.client_secret).toMatch(/^ktcs_/);
	});
});

describe('teljes OAuth-folyamat az MCP SDK kliensével', () => {
	it('401 → felfedezés → DCR → hozzájárulás → token → MCP-hívás a felhasználó nevében', async () => {
		const s = await seed(db);
		const fetchImpl = serverFetch(db);
		let seenAuthorizeUrl: URL | null = null;
		const mp = memoryProvider('http://localhost:33418/callback', async (url) => {
			seenAuthorizeUrl = url;
			// A böngészőben a kolléga belépett és az „Engedélyezem” gombra kattintott:
			const v = await validateAuthorizeRequest(db, cfg, url.searchParams);
			if (!v.ok) throw new Error(JSON.stringify(v));
			const back = new URL(await approveAuthorization(db, cfg, v.req, s.kollega.id));
			expect(back.searchParams.get('state')).toBe(url.searchParams.get('state'));
			expect(back.searchParams.get('iss')).toBe(ORIGIN);
			return back.searchParams.get('code')!;
		});

		const mk = () =>
			new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: fetchImpl, authProvider: mp.provider });
		let transport = mk();
		const client = new Client({ name: 'teszt', version: '1' });
		await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);

		expect(seenAuthorizeUrl).not.toBeNull();
		const au = seenAuthorizeUrl!;
		expect(au.origin + au.pathname).toBe(`${ORIGIN}/oauth/authorize`);
		expect(au.searchParams.get('code_challenge_method')).toBe('S256');
		expect(au.searchParams.get('resource')).toBe(`${ORIGIN}/mcp`);

		await transport.finishAuth(mp.state.lastCode);
		transport = mk();
		const client2 = new Client({ name: 'teszt', version: '1' });
		await client2.connect(transport);
		const r = (await client2.callTool({
			name: 'replace_section',
			arguments: { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'OAuth-ról', reason: 'próba' }
		})) as { isError?: boolean };
		expect(r.isError).toBeFalsy();
		const revs = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(revs.content).toBe('OAuth-ról');

		const clients = await listConnectedClients(db, s.kollega.id);
		expect(clients.map((c) => c.name)).toEqual(['Teszt Claude']);

		// Visszavonás után a token azonnal érvénytelen.
		await disconnectClient(db, s.kollega.id, clients[0].clientId);
		expect(await verifyAccessToken(db, cfg, mp.getTokens()!.access_token)).toBeNull();
		await client2.close();
	});
});

describe('token-végpont szabályai', () => {
	async function codeFor(userId: string, opts: { verifier?: string; resource?: string | null } = {}) {
		const reg = await registerClient(db, {
			redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
			token_endpoint_auth_method: 'client_secret_post',
			client_name: 'Claude'
		});
		const verifier = opts.verifier ?? 'v'.repeat(50);
		const params = new URLSearchParams({
			client_id: reg.client_id,
			redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
			response_type: 'code',
			code_challenge: sha256(verifier),
			code_challenge_method: 'S256',
			state: 'xyz'
		});
		if (opts.resource !== null) params.set('resource', opts.resource ?? `${ORIGIN}/mcp`);
		const v = await validateAuthorizeRequest(db, cfg, params);
		if (!v.ok) throw new Error('authorize');
		const code = new URL(await approveAuthorization(db, cfg, v.req, userId)).searchParams.get('code')!;
		return { reg, code, verifier };
	}
	const tokenReq = (body: Record<string, string>) =>
		new Request(`${ORIGIN}/oauth/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(body)
		});

	it('hibás PKCE, rossz titok, kód-újrahasználat (ami a kiadott tokeneket is visszavonja)', async () => {
		const s = await seed(db);
		const ep = oauthEndpoints(db, cfg);
		const { reg, code, verifier } = await codeFor(s.levente.id);
		const base = {
			grant_type: 'authorization_code',
			code,
			redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
			client_id: reg.client_id,
			client_secret: reg.client_secret!
		};
		expect((await ep.token(tokenReq({ ...base, code_verifier: 'x'.repeat(50) }))).status).toBe(400);
		expect((await ep.token(tokenReq({ ...base, client_secret: 'rossz', code_verifier: verifier }))).status).toBe(401);
		const ok = await ep.token(tokenReq({ ...base, code_verifier: verifier }));
		expect(ok.status).toBe(200);
		const t = (await ok.json()) as { access_token: string; refresh_token: string; token_type: string };
		expect(t.token_type).toBe('Bearer');
		expect(await verifyAccessToken(db, cfg, t.access_token)).toMatchObject({ userId: s.levente.id });

		const again = await ep.token(tokenReq({ ...base, code_verifier: verifier }));
		expect(again.status).toBe(400);
		expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
		expect(await verifyAccessToken(db, cfg, t.access_token)).toBeNull();
	});

	it('frissítő token forgatása; a régi újrahasználata (türelmi idő után) az egész családot visszavonja', async () => {
		const s = await seed(db);
		const ep = oauthEndpoints(db, cfg);
		const { reg, code, verifier } = await codeFor(s.levente.id, { resource: null });
		const auth = { client_id: reg.client_id, client_secret: reg.client_secret! };
		const t1 = (await (await ep.token(tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, ...auth }))).json()) as {
			access_token: string;
			refresh_token: string;
		};
		const r2 = await ep.token(tokenReq({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, ...auth }));
		const t2 = (await r2.json()) as { access_token: string; refresh_token: string };
		expect(r2.status).toBe(200);
		expect(await verifyAccessToken(db, cfg, t1.access_token)).toBeNull(); // a régi hozzáférési token is lejárt
		expect(await verifyAccessToken(db, cfg, t2.access_token)).not.toBeNull();

		// párhuzamos frissítés (türelmi időn belül): hiba, de a család él
		expect((await ep.token(tokenReq({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, ...auth }))).status).toBe(400);
		expect(await verifyAccessToken(db, cfg, t2.access_token)).not.toBeNull();

		// később: ellopott token újrahasználata → minden visszavonva
		clock.now = minutesFromNow(5);
		expect((await ep.token(tokenReq({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, ...auth }))).status).toBe(400);
		expect(await verifyAccessToken(db, cfg, t2.access_token)).toBeNull();
		expect((await ep.token(tokenReq({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, ...auth }))).status).toBe(400);
	});

	it('a hozzáférési token lejár; idegen erőforrásra nem ad ki kódot', async () => {
		const s = await seed(db);
		const ep = oauthEndpoints(db, cfg);
		const { reg, code, verifier } = await codeFor(s.levente.id);
		const t = (await (
			await ep.token(tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, client_secret: reg.client_secret! }))
		).json()) as { access_token: string };
		clock.now = minutesFromNow(61);
		expect(await verifyAccessToken(db, cfg, t.access_token)).toBeNull();

		const params = new URLSearchParams({
			client_id: reg.client_id,
			redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
			response_type: 'code',
			code_challenge: sha256('v'.repeat(50)),
			code_challenge_method: 'S256',
			resource: 'https://mas.example.com/mcp'
		});
		const v = await validateAuthorizeRequest(db, cfg, params);
		expect(v.ok).toBe(false);
		expect('redirect' in v && v.redirect).toContain('error=invalid_target');
		// regisztrálatlan átirányításra nem irányítunk sehova
		params.set('redirect_uri', 'https://evil.example.com/cb');
		const v2 = await validateAuthorizeRequest(db, cfg, params);
		expect('fatal' in v2).toBe(true);
	});

	it('401 válasz a metaadat címével; a metaadatok a szabvány mezőit adják', async () => {
		const f = serverFetch(db);
		const r = await f(`${ORIGIN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		expect(r.status).toBe(401);
		expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
		const prm = await (await f(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)).json();
		expect(prm).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
		const asm = await (await f(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
		expect(asm).toMatchObject({
			issuer: ORIGIN,
			registration_endpoint: `${ORIGIN}/oauth/register`,
			code_challenge_methods_supported: ['S256']
		});
	});
});

describe('Google-belépés', () => {
	it('PKCE-vel és állapottal indít, a callback-címmel; a userinfo adja a profilt', async () => {
		const { startGoogleLogin, finishGoogleLogin, safeNext } = await import('../src/lib/server/auth/google');
		const gcfg = authConfigFromEnv({ ORIGIN: 'https://terv.example.test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
		const { url, flow } = startGoogleLogin(gcfg, '/oauth/authorize?x=1');
		const u = new URL(url);
		expect(u.searchParams.get('redirect_uri')).toBe('https://terv.example.test/api/auth/callback/google');
		expect(u.searchParams.get('code_challenge')).toBe(sha256(flow.verifier));
		expect(u.searchParams.get('state')).toBe(flow.state);
		expect(flow.next).toBe('/oauth/authorize?x=1');

		const calls: { url: string; body?: string }[] = [];
		const fake = (async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(input), body: init?.body?.toString() });
			if (String(input).includes('token')) return Response.json({ access_token: 'g-at' });
			return Response.json({ email: 'Levente@Gmail.com', email_verified: true, name: 'Levente', picture: 'p' });
		}) as typeof fetch;
		const p = await finishGoogleLogin(gcfg, 'gcode', flow, fake);
		expect(p).toEqual({ email: 'levente@gmail.com', emailVerified: true, name: 'Levente', picture: 'p' });
		expect(calls[0].body).toContain(`code_verifier=${flow.verifier}`);

		expect(safeNext('https://evil.com')).toBe('/');
		expect(safeNext('//evil.com')).toBe('/');
		expect(safeNext('/x')).toBe('/x');
	});
});
