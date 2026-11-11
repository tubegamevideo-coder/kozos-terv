import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, options: { max?: number } = {}) {
	const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
	const db = drizzle(client, { schema });
	return { db, client };
}

export { schema };
