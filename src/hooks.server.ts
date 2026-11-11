import type { Handle } from '@sveltejs/kit/hooks';
import { getDb } from './lib/server/db/client';
import { getSessionUser, SESSION_COOKIE } from './lib/server/auth/sessions';
import { getAuthConfig } from './lib/server/auth/config';

/** Sütiket nem használó, szerverek közti végpontok: ezekre nem kell Origin-ellenőrzés. */
const API_PATHS = ['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isApi = API_PATHS.includes(path);

	// Saját CSRF-védelem a sütis kérésekre (a beépítettet az OAuth miatt kikapcsoltuk).
	if (MUTATING.has(event.request.method) && !isApi) {
		const origin = event.request.headers.get('origin');
		const self = getAuthConfig().origin;
		if (origin !== self && origin !== event.url.origin) {
			return new Response('Cross-site kérés tiltva', { status: 403 });
		}
	}

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = !isApi && token ? await getSessionUser(getDb(), token) : null;

	// Választott téma (süti): már a szerver beírja a <html>-be, így nincs villanás betöltéskor.
	const theme = event.cookies.get('kt_theme');
	const response = await resolve(event, {
		transformPageChunk:
			theme === 'light' || theme === 'dark'
				? ({ html }) => html.replace('<html lang="hu"', `<html lang="hu" data-theme="${theme}"`)
				: undefined
	});
	if (!isApi) {
		response.headers.set('x-frame-options', 'DENY');
		response.headers.set('content-security-policy', "frame-ancestors 'none'");
		response.headers.set('referrer-policy', 'same-origin');
		response.headers.set('x-content-type-options', 'nosniff');
	}
	return response;
};
