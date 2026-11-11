import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/lib/server/db/index';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL nincs beállítva');
	process.exit(1);
}

const { db, client } = createDb(url, { max: 1 });
await migrate(db, { migrationsFolder: './drizzle' });
await client.end();
console.log('Migráció kész.');
