import type { RequestHandler } from './$types';
import { getDb } from '../../lib/server/db/client';
import { bearerToken, devActorResolver, parseDevTokens } from '../../lib/server/auth/dev';
import { getAuthConfig } from '../../lib/server/auth/config';
import { resourceMetadataUrl, verifyAccessToken } from '../../lib/server/auth/oauth';
import { handleMcpRequest, type ResolveActor } from '../../lib/server/mcp/http';

let resolver: ResolveActor | null = null;

function getResolver(): ResolveActor {
	if (resolver) return resolver;
	const cfg = getAuthConfig();
	const db = getDb();
	if (cfg.mode === 'dev' && cfg.secureCookies) {
		// Fejlesztői (statikus) tokenek nyilvános HTTPS-címen nem használhatók.
		throw new Error('AUTH_MODE=dev nyilvános (https) ORIGIN mellett tiltott; állítsd AUTH_MODE=oauth-ra.');
	}
	resolver =
		cfg.mode === 'oauth'
			? async (request) => {
					const v = await verifyAccessToken(db, cfg, bearerToken(request));
					return v ? { userId: v.userId, kind: 'claude' } : null;
				}
			: devActorResolver(db, parseDevTokens(process.env.MCP_DEV_TOKENS));
	return resolver;
}

const handle: RequestHandler = async ({ request }) => {
	const cfg = getAuthConfig();
	return handleMcpRequest(request, {
		db: getDb(),
		resolveActor: getResolver(),
		resourceMetadataUrl: cfg.mode === 'oauth' ? resourceMetadataUrl(cfg) : undefined
	});
};

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
