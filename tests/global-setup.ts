import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/lib/server/db/index';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/kozos_terv_test';

/** Tiszta sémát épít a tesztadatbázisban, majd lefuttatja a migrációkat. */
export default async function setup() {
	const { db, client } = createDb(TEST_URL, { max: 1 });
	await client.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
	await migrate(db, { migrationsFolder: './drizzle' });
	await client.end();
}
