const env = process.env;
import { createDb, type Db } from './index';

let instance: Db | null = null;

/** Az alkalmazás egyetlen adatbázis-kapcsolata (lusta létrehozással, hogy a build ne igényeljen DB-t). */
export function getDb(): Db {
	if (!instance) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL nincs beállítva');
		instance = createDb(env.DATABASE_URL, { max: Number(env.DATABASE_POOL_MAX ?? 10) }).db;
	}
	return instance;
}
