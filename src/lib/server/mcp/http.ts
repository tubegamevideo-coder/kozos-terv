import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Db } from '../db';
import type { Actor } from '../core';
import { buildMcpServer } from './server';

export type ResolveActor = (request: Request) => Promise<Actor | null>;

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

/**
 * A /mcp végpont: állapotmentes Streamable HTTP. Kérésenként új szerver a hitelesített
 * felhasználóhoz kötve, JSON-válasszal (nincs hosszan nyitva tartott stream, így proxy és
 * Cloudflare Tunnel mögött is egyszerű).
 */
export async function handleMcpRequest(
	request: Request,
	opts: { db: Db; resolveActor: ResolveActor; resourceMetadataUrl?: string }
): Promise<Response> {
	if (request.method === 'GET' || request.method === 'DELETE') {
		// Állapotmentes szerver: nincs külön értesítési stream és nincs zárható munkamenet.
		return jsonRpcError(405, 'Method not allowed', { allow: 'POST' });
	}
	if (request.method !== 'POST') return jsonRpcError(405, 'Method not allowed', { allow: 'POST' });

	const actor = await opts.resolveActor(request);
	if (!actor) {
		const challenge = opts.resourceMetadataUrl
			? `Bearer resource_metadata="${opts.resourceMetadataUrl}"`
			: 'Bearer realm="kozos-terv"';
		return jsonRpcError(401, 'Unauthorized', { 'www-authenticate': challenge });
	}

	const server = buildMcpServer(opts.db, actor);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	try {
		await server.connect(transport);
		return await transport.handleRequest(request);
	} finally {
		// JSON-módban a válasz a visszatéréskor már teljes; a szerver eldobható.
		void server.close();
	}
}
