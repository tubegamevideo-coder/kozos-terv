import { sql } from 'drizzle-orm';
import { getDb } from '../../lib/server/db/client';

/** Életjel a Docker és az Uptime Kuma számára: a szerver fut és eléri az adatbázist. */
export const GET = async () => {
	try {
		await getDb().execute(sql`select 1`);
		return new Response('ok', { headers: { 'cache-control': 'no-store' } });
	} catch {
		return new Response('db unavailable', { status: 503 });
	}
};
