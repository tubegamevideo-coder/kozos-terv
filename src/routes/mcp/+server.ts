import type { RequestHandler } from './$types';
import { getDb } from '../../lib/server/db/client';
import { devActorResolver, parseDevTokens } from '../../lib/server/auth/dev';
import { handleMcpRequest, type ResolveActor } from '../../lib/server/mcp/http';

let resolver: ResolveActor | null = null;

function getResolver(): ResolveActor {
	if (resolver) return resolver;
	const mode = process.env.AUTH_MODE ?? 'dev';
	if (mode !== 'dev') {
		// A 3. lépésben itt jön az OAuth-tokenek ellenőrzése.
		throw new Error(`AUTH_MODE=${mode} még nincs megvalósítva`);
	}
	resolver = devActorResolver(getDb(), parseDevTokens(process.env.MCP_DEV_TOKENS));
	return resolver;
}

const handle: RequestHandler = async ({ request }) =>
	handleMcpRequest(request, { db: getDb(), resolveActor: getResolver() });

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
