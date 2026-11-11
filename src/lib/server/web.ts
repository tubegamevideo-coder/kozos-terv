import { error, fail, redirect } from '@sveltejs/kit';
import { CoreError, type Actor } from './core';

/** A bejelentkezett ember mint szereplő; ha nincs belépve, a belépésre irányít. */
export function humanActor(locals: App.Locals, url: URL): Actor {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	return { userId: locals.user.id, kind: 'human' };
}

/** Betöltéskor: CoreError → HTTP-hiba (404 / 403 / 400). */
export async function orError<T>(p: Promise<T>): Promise<T> {
	try {
		return await p;
	} catch (e) {
		if (e instanceof CoreError) {
			const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' || e.code === 'HUMAN_ONLY' ? 403 : 400;
			error(status, e.message);
		}
		throw e;
	}
}

/** Űrlap-műveletnél: CoreError → fail() a részletekkel, hogy az oldal megmutassa. */
export async function orFail<T>(p: Promise<T>) {
	try {
		return { ok: true as const, value: await p };
	} catch (e) {
		if (e instanceof CoreError) {
			return { ok: false as const, failure: fail(400, { error: e.message, code: e.code, details: e.details }) };
		}
		throw e;
	}
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? '');
export const int = (f: FormData, k: string) => Number.parseInt(str(f, k), 10);
