import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '../../../lib/server/db/client';
import { getAuthConfig } from '../../../lib/server/auth/config';
import {
	approveAuthorization,
	denyAuthorization,
	validateAuthorizeRequest
} from '../../../lib/server/auth/oauth';

async function validate(url: URL) {
	const v = await validateAuthorizeRequest(getDb(), getAuthConfig(), url.searchParams);
	if (!v.ok && 'fatal' in v) error(400, v.fatal);
	if (!v.ok) redirect(303, v.redirect, { external: true });
	return v.req;
}

/** Hozzájárulási oldal: a Claude-kliens hozzáférést kér a felhasználó nevében. */
export const load: PageServerLoad = async ({ url, locals }) => {
	const req = await validate(url);
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const redirectHost = new URL(req.redirectUri).host;
	return { clientName: req.clientName, redirectHost, user: locals.user };
};

export const actions: Actions = {
	default: async ({ url, locals, request }) => {
		const req = await validate(url);
		if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
		const form = await request.formData();
		const cfg = getAuthConfig();
		if (form.get('decision') === 'approve') {
			redirect(303, await approveAuthorization(getDb(), cfg, req, locals.user.id), { external: true });
		}
		redirect(303, denyAuthorization(cfg, req), { external: true });
	}
};
