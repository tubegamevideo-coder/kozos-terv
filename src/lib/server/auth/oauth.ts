/**
 * Kis, saját OAuth 2.1 hitelesítési szerver az MCP-hez (MCP Authorization spec):
 * dinamikus kliensregisztráció (RFC 7591), engedélyezési kód PKCE-vel (S256 kötelező),
 * frissítő token forgatással és újrahasználat-észleléssel, erőforrás-kötés (RFC 8707),
 * metaadatok (RFC 8414, RFC 9728), visszavonás (RFC 7009).
 *
 * A tokenek átlátszatlanok (nem JWT), az adatbázisban csak a SHA-256 hash-ük van,
 * így a visszavonás azonnali.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { oauthClient, oauthCode, oauthToken } from '../db/schema';
import { clock } from '../core/types';
import type { AuthConfig } from './config';
import { randomToken, safeEqual, sha256, verifyPkce } from './crypto';

export const SCOPES = ['terv'] as const;
const CODE_TTL_SEC = 600;

export class OAuthError extends Error {
	constructor(
		public readonly error: string,
		public readonly description: string,
		public readonly status = 400
	) {
		super(description);
	}
	toResponse(extraHeaders: Record<string, string> = {}) {
		return json({ error: this.error, error_description: this.description }, this.status, extraHeaders);
	}
}

export const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version'
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers }
	});
}

// ------------------------------------------------------------ metaadatok

export function authServerMetadata(cfg: AuthConfig) {
	return {
		issuer: cfg.origin,
		authorization_endpoint: `${cfg.origin}/oauth/authorize`,
		token_endpoint: `${cfg.origin}/oauth/token`,
		registration_endpoint: `${cfg.origin}/oauth/register`,
		revocation_endpoint: `${cfg.origin}/oauth/revoke`,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
		revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
		scopes_supported: [...SCOPES],
		service_documentation: `${cfg.origin}/`
	};
}

export function protectedResourceMetadata(cfg: AuthConfig) {
	return {
		resource: cfg.mcpResource,
		authorization_servers: [cfg.origin],
		scopes_supported: [...SCOPES],
		bearer_methods_supported: ['header'],
		resource_name: 'Közös tervezőapp'
	};
}

export const resourceMetadataUrl = (cfg: AuthConfig) => `${cfg.origin}/.well-known/oauth-protected-resource/mcp`;

// ------------------------------------------------------------ segédek

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedRedirectUri(uri: string) {
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return false;
	}
	if (u.hash || u.username || u.password) return false;
	if (u.protocol === 'https:') return true;
	return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

/** RFC 8252: loopback átirányításnál a port tetszőleges lehet; egyébként pontos egyezés kell. */
export function redirectUriMatches(requested: string, registered: readonly string[]) {
	if (registered.includes(requested)) return true;
	let r: URL;
	try {
		r = new URL(requested);
	} catch {
		return false;
	}
	if (r.protocol !== 'http:' || !LOOPBACK.has(r.hostname)) return false;
	return registered.some((x) => {
		try {
			const g = new URL(x);
			return g.protocol === 'http:' && g.hostname === r.hostname && g.pathname === r.pathname && g.search === r.search;
		} catch {
			return false;
		}
	});
}

/** Az erőforrás-paraméter (ha van) csak a mi MCP-végpontunk lehet. */
export function normalizeResource(cfg: AuthConfig, resource: string | null | undefined) {
	if (!resource) return null;
	const strip = (s: string) => s.replace(/\/+$/, '');
	const r = strip(resource);
	if (r === strip(cfg.mcpResource) || r === strip(cfg.origin)) return cfg.mcpResource;
	throw new OAuthError('invalid_target', `Ismeretlen erőforrás: ${resource}`);
}

function normalizeScope(scope: string | null | undefined) {
	const requested = (scope ?? '').split(/\s+/).filter(Boolean);
	// Ismeretlen hatókört (pl. openid, offline_access) csendben elhagyunk; egyetlen hatókörünk van.
	return requested.filter((s) => (SCOPES as readonly string[]).includes(s)).join(' ') || SCOPES.join(' ');
}

// ------------------------------------------------------------ regisztráció (RFC 7591)

export async function registerClient(db: Db, body: unknown) {
	const b = (body ?? {}) as Record<string, unknown>;
	const redirectUris = b.redirect_uris;
	if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10) {
		throw new OAuthError('invalid_redirect_uri', 'redirect_uris: 1–10 cím kell.');
	}
	for (const u of redirectUris) {
		if (typeof u !== 'string' || !isAllowedRedirectUri(u)) {
			throw new OAuthError('invalid_redirect_uri', `Nem engedélyezett átirányítási cím: ${String(u)}`);
		}
	}
	const method = (b.token_endpoint_auth_method as string | undefined) ?? 'client_secret_basic';
	if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
		throw new OAuthError('invalid_client_metadata', `Nem támogatott token_endpoint_auth_method: ${method}`);
	}
	const grantTypes = (b.grant_types as string[] | undefined) ?? ['authorization_code', 'refresh_token'];
	if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')) {
		throw new OAuthError('invalid_client_metadata', 'A grant_types-nak tartalmaznia kell az authorization_code-ot.');
	}
	const name = typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : 'Ismeretlen kliens';
	const clientUri = typeof b.client_uri === 'string' ? b.client_uri.slice(0, 300) : null;
	const clientId = randomToken('ktc_');
	const secret = method === 'none' ? null : randomToken('ktcs_');
	await db.insert(oauthClient).values({
		id: clientId,
		name,
		redirectUris: redirectUris as string[],
		tokenEndpointAuthMethod: method,
		secretHash: secret ? sha256(secret) : null,
		clientUri
	});
	return {
		client_id: clientId,
		client_id_issued_at: Math.floor(clock.now().getTime() / 1000),
		...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
		client_name: name,
		redirect_uris: redirectUris,
		token_endpoint_auth_method: method,
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		scope: SCOPES.join(' ')
	};
}

// ------------------------------------------------------------ engedélyezés

export interface AuthorizeRequest {
	clientId: string;
	clientName: string;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	resource: string | null;
	scope: string;
}

/**
 * Ellenőrzi az /oauth/authorize kérést. Két hibafajta van: ha a kliens vagy az átirányítási
 * cím rossz, `fatal` (hibaoldal, nem irányítunk sehova); egyébként a hibát a kliensnek
 * küldjük vissza az átirányítási címre.
 */
export async function validateAuthorizeRequest(
	db: Db,
	cfg: AuthConfig,
	params: URLSearchParams
): Promise<{ ok: true; req: AuthorizeRequest } | { ok: false; fatal: string } | { ok: false; redirect: string }> {
	const clientId = params.get('client_id');
	if (!clientId) return { ok: false, fatal: 'Hiányzik a client_id.' };
	const [client] = await db.select().from(oauthClient).where(eq(oauthClient.id, clientId));
	if (!client) return { ok: false, fatal: 'Ismeretlen kliens. Kapcsold újra a csatlakozót a Claude-ban.' };
	let redirectUri = params.get('redirect_uri');
	if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
	if (!redirectUri || !redirectUriMatches(redirectUri, client.redirectUris)) {
		return { ok: false, fatal: 'Az átirányítási cím nincs regisztrálva ennél a kliensnél.' };
	}
	const state = params.get('state');
	const fail = (error: string, description: string) => {
		const u = new URL(redirectUri!);
		u.searchParams.set('error', error);
		u.searchParams.set('error_description', description);
		if (state) u.searchParams.set('state', state);
		u.searchParams.set('iss', cfg.origin);
		return { ok: false as const, redirect: u.toString() };
	};
	if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Csak response_type=code.');
	const codeChallenge = params.get('code_challenge');
	if (!codeChallenge || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
		return fail('invalid_request', 'PKCE kötelező (code_challenge, S256).');
	}
	let resource: string | null;
	try {
		resource = normalizeResource(cfg, params.get('resource'));
	} catch (e) {
		return fail('invalid_target', (e as Error).message);
	}
	return {
		ok: true,
		req: {
			clientId,
			clientName: client.name,
			redirectUri,
			state,
			codeChallenge,
			resource,
			scope: normalizeScope(params.get('scope'))
		}
	};
}

/** A felhasználó jóváhagyta: kódot ad ki, és visszaadja az átirányítási címet. */
export async function approveAuthorization(db: Db, cfg: AuthConfig, req: AuthorizeRequest, userId: string) {
	const code = randomToken('ktac_');
	await db.insert(oauthCode).values({
		codeHash: sha256(code),
		clientId: req.clientId,
		userId,
		redirectUri: req.redirectUri,
		codeChallenge: req.codeChallenge,
		resource: req.resource,
		scope: req.scope,
		familyId: crypto.randomUUID(),
		expiresAt: new Date(clock.now().getTime() + CODE_TTL_SEC * 1000)
	});
	const u = new URL(req.redirectUri);
	u.searchParams.set('code', code);
	if (req.state) u.searchParams.set('state', req.state);
	u.searchParams.set('iss', cfg.origin);
	return u.toString();
}

export function denyAuthorization(cfg: AuthConfig, req: AuthorizeRequest) {
	const u = new URL(req.redirectUri);
	u.searchParams.set('error', 'access_denied');
	u.searchParams.set('error_description', 'A felhasználó elutasította a hozzáférést.');
	if (req.state) u.searchParams.set('state', req.state);
	u.searchParams.set('iss', cfg.origin);
	return u.toString();
}

// ------------------------------------------------------------ token-végpont

async function readForm(request: Request) {
	const ct = request.headers.get('content-type') ?? '';
	if (ct.includes('application/json')) {
		const j = (await request.json()) as Record<string, string>;
		return new URLSearchParams(Object.entries(j).map(([k, v]) => [k, String(v)]));
	}
	return new URLSearchParams(await request.text());
}

/** Kliens-hitelesítés: Basic fejléc, client_secret a törzsben, vagy nyilvános kliens (none). */
async function authenticateClient(db: Db, request: Request, form: URLSearchParams) {
	let clientId = form.get('client_id');
	let secret = form.get('client_secret');
	const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i);
	if (basic) {
		const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
		const i = decoded.indexOf(':');
		if (i < 0) throw new OAuthError('invalid_client', 'Hibás Basic fejléc.', 401);
		clientId = decodeURIComponent(decoded.slice(0, i));
		secret = decodeURIComponent(decoded.slice(i + 1));
	}
	if (!clientId) throw new OAuthError('invalid_client', 'Hiányzik a client_id.', 401);
	const [client] = await db.select().from(oauthClient).where(eq(oauthClient.id, clientId));
	if (!client) throw new OAuthError('invalid_client', 'Ismeretlen kliens.', 401);
	if (client.secretHash) {
		if (!secret || !safeEqual(sha256(secret), client.secretHash)) {
			throw new OAuthError('invalid_client', 'Hibás kliens-titok.', 401);
		}
	}
	return client;
}

async function issueTokens(
	db: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
	cfg: AuthConfig,
	g: { clientId: string; userId: string; familyId: string; resource: string | null; scope: string }
) {
	const now = clock.now().getTime();
	const access = randomToken('kta_');
	const refresh = randomToken('ktr_');
	await db.insert(oauthToken).values([
		{ kind: 'access', tokenHash: sha256(access), ...g, expiresAt: new Date(now + cfg.accessTokenTtlSec * 1000) },
		{ kind: 'refresh', tokenHash: sha256(refresh), ...g, expiresAt: new Date(now + cfg.refreshTokenTtlSec * 1000) }
	]);
	return {
		access_token: access,
		token_type: 'Bearer',
		expires_in: cfg.accessTokenTtlSec,
		refresh_token: refresh,
		scope: g.scope
	};
}

async function revokeFamily(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], familyId: string) {
	await db
		.update(oauthToken)
		.set({ revokedAt: clock.now() })
		.where(and(eq(oauthToken.familyId, familyId), isNull(oauthToken.revokedAt)));
}

export async function exchangeToken(db: Db, cfg: AuthConfig, request: Request) {
	const form = await readForm(request);
	const client = await authenticateClient(db, request, form);
	const grant = form.get('grant_type');
	const resourceParam = form.get('resource');

	if (grant === 'authorization_code') {
		const code = form.get('code');
		const verifier = form.get('code_verifier');
		if (!code || !verifier) throw new OAuthError('invalid_request', 'code és code_verifier kell.');
		const result = await db.transaction(async (tx) => {
			const [row] = await tx.select().from(oauthCode).where(eq(oauthCode.codeHash, sha256(code))).for('update');
			if (!row || row.clientId !== client.id) return { error: 'Érvénytelen kód.' } as const;
			if (row.usedAt) {
				// A kódot már beváltották: lehet, hogy ellopták – a belőle kiadott tokeneket is visszavonjuk.
				await revokeFamily(tx, row.familyId);
				return { error: 'A kódot már felhasználták.' } as const;
			}
			if (row.expiresAt <= clock.now()) return { error: 'A kód lejárt.' } as const;
			const redirectUri = form.get('redirect_uri');
			if (redirectUri && redirectUri !== row.redirectUri) return { error: 'Az átirányítási cím eltér.' } as const;
			if (!verifyPkce(verifier, row.codeChallenge)) return { error: 'Hibás PKCE code_verifier.' } as const;
			if (resourceParam && normalizeResource(cfg, resourceParam) !== (row.resource ?? cfg.mcpResource)) {
				throw new OAuthError('invalid_target', 'Az erőforrás eltér az engedélyezettől.');
			}
			await tx.update(oauthCode).set({ usedAt: clock.now() }).where(eq(oauthCode.codeHash, row.codeHash));
			return issueTokens(tx, cfg, {
				clientId: client.id,
				userId: row.userId,
				familyId: row.familyId,
				resource: row.resource ?? cfg.mcpResource,
				scope: row.scope
			});
		});
		if ('error' in result) throw new OAuthError('invalid_grant', result.error as string);
		await touchClient(db, client.id);
		return result;
	}

	if (grant === 'refresh_token') {
		const refresh = form.get('refresh_token');
		if (!refresh) throw new OAuthError('invalid_request', 'refresh_token kell.');
		const result = await db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(oauthToken)
				.where(and(eq(oauthToken.tokenHash, sha256(refresh)), eq(oauthToken.kind, 'refresh')))
				.for('update');
			if (!row || row.clientId !== client.id) return { error: 'Érvénytelen frissítő token.' } as const;
			if (row.revokedAt) {
				// Már elforgatott token újrahasználata: a teljes családot visszavonjuk – kivéve, ha
				// pár másodperce forgattuk (két párhuzamos frissítés ugyanattól a klienstől).
				const graceMs = 30_000;
				if (clock.now().getTime() - row.revokedAt.getTime() > graceMs) await revokeFamily(tx, row.familyId);
				return { error: 'A frissítő tokent már felhasználták vagy visszavonták.' } as const;
			}
			if (row.expiresAt <= clock.now()) return { error: 'A frissítő token lejárt.' } as const;
			if (resourceParam && normalizeResource(cfg, resourceParam) !== (row.resource ?? cfg.mcpResource)) {
				throw new OAuthError('invalid_target', 'Az erőforrás eltér az engedélyezettől.');
			}
			// Forgatás: a régi frissítő és az eddigi hozzáférési tokenek érvénytelenek lesznek.
			await revokeFamily(tx, row.familyId);
			return issueTokens(tx, cfg, {
				clientId: client.id,
				userId: row.userId,
				familyId: row.familyId,
				resource: row.resource,
				scope: row.scope
			});
		});
		if ('error' in result) throw new OAuthError('invalid_grant', result.error as string);
		await touchClient(db, client.id);
		return result;
	}

	throw new OAuthError('unsupported_grant_type', `Nem támogatott grant_type: ${grant}`);
}

async function touchClient(db: Db, clientId: string) {
	await db.update(oauthClient).set({ lastUsedAt: clock.now() }).where(eq(oauthClient.id, clientId));
}

/** RFC 7009: a token (és családja) visszavonása. Ismeretlen tokenre is 200-at adunk. */
export async function revokeToken(db: Db, request: Request) {
	const form = await readForm(request);
	const client = await authenticateClient(db, request, form);
	const token = form.get('token');
	if (!token) throw new OAuthError('invalid_request', 'token kell.');
	const [row] = await db.select().from(oauthToken).where(eq(oauthToken.tokenHash, sha256(token)));
	if (row && row.clientId === client.id) await revokeFamily(db, row.familyId);
}

// ------------------------------------------------------------ erőforrás-szerver oldal

/** Bearer-token → felhasználó, ha a token érvényes hozzáférési token a mi MCP-erőforrásunkra. */
export async function verifyAccessToken(db: Db, cfg: AuthConfig, token: string | null) {
	if (!token) return null;
	const [row] = await db
		.select()
		.from(oauthToken)
		.where(
			and(
				eq(oauthToken.tokenHash, sha256(token)),
				eq(oauthToken.kind, 'access'),
				isNull(oauthToken.revokedAt),
				gt(oauthToken.expiresAt, clock.now())
			)
		);
	if (!row) return null;
	if (row.resource && row.resource !== cfg.mcpResource) return null;
	// Utolsó használat: legfeljebb percenként egyszer írjuk.
	await db
		.update(oauthToken)
		.set({ lastUsedAt: clock.now() })
		.where(
			and(
				eq(oauthToken.id, row.id),
				sql`(${oauthToken.lastUsedAt} is null or ${oauthToken.lastUsedAt} < now() - interval '1 minute')`
			)
		);
	return { userId: row.userId, clientId: row.clientId };
}

// ------------------------------------------------------------ a felhasználó kliensei

/** A felhasználó kapcsolódott Claude-kliensei (amelyekhez van élő frissítő tokenje). */
export async function listConnectedClients(db: Db, userId: string) {
	return db
		.select({
			clientId: oauthClient.id,
			name: oauthClient.name,
			connectedAt: sql<Date>`min(${oauthToken.createdAt})`.mapWith((v) => new Date(v)),
			lastUsedAt: sql<Date | null>`max(${oauthToken.lastUsedAt})`.mapWith((v) => (v ? new Date(v) : null))
		})
		.from(oauthToken)
		.innerJoin(oauthClient, eq(oauthClient.id, oauthToken.clientId))
		.where(
			and(
				eq(oauthToken.userId, userId),
				eq(oauthToken.kind, 'refresh'),
				isNull(oauthToken.revokedAt),
				gt(oauthToken.expiresAt, clock.now())
			)
		)
		.groupBy(oauthClient.id, oauthClient.name);
}

export async function disconnectClient(db: Db, userId: string, clientId: string) {
	await db
		.update(oauthToken)
		.set({ revokedAt: clock.now() })
		.where(and(eq(oauthToken.userId, userId), eq(oauthToken.clientId, clientId), isNull(oauthToken.revokedAt)));
}
