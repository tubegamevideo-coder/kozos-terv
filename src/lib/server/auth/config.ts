export interface AuthConfig {
	/** A nyilvános cím, pl. https://terv.nebulooo.com (ez az OAuth issuer is). */
	origin: string;
	/** Az MCP-erőforrás azonosítója (RFC 8707): `${origin}/mcp` */
	mcpResource: string;
	mode: 'dev' | 'oauth';
	google: {
		clientId: string;
		clientSecret: string;
		authorizeUrl: string;
		tokenUrl: string;
		userinfoUrl: string;
	};
	secureCookies: boolean;
	accessTokenTtlSec: number;
	refreshTokenTtlSec: number;
	sessionTtlSec: number;
}

export function authConfigFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig {
	const origin = (env.ORIGIN ?? 'http://localhost:3100').replace(/\/$/, '');
	const mode = env.AUTH_MODE === 'oauth' ? 'oauth' : 'dev';
	return {
		origin,
		mcpResource: `${origin}/mcp`,
		mode,
		google: {
			clientId: env.GOOGLE_CLIENT_ID ?? '',
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
			authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo'
		},
		secureCookies: origin.startsWith('https://'),
		accessTokenTtlSec: 60 * 60,
		refreshTokenTtlSec: 60 * 60 * 24 * 30,
		sessionTtlSec: 60 * 60 * 24 * 30
	};
}

let cached: AuthConfig | null = null;
export const getAuthConfig = () => (cached ??= authConfigFromEnv());
