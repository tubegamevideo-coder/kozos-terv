import { sql } from 'drizzle-orm';
import type { Tx } from '../db';
import { event } from '../db/schema';
import type { Actor } from './types';

export const EVENT_CHANNEL = 'kozos_terv_events';

export interface EventInput {
	projectId: string;
	type: string;
	targetType: string;
	targetId: string;
	summary: string;
	data?: Record<string, unknown>;
}

/**
 * Eseményt ír a naplóba, és értesíti az élő felületet (LISTEN/NOTIFY, commitkor küldődik).
 *
 * Projektenkénti tranzakciós tanácsadó zárat vesz fel, így egy projekt eseményei abban a
 * sorrendben commitolódnak, ahogy az azonosítójuk nő. Ettől megbízható az `id` kurzorként
 * (`get_changes`): nem fordulhat elő, hogy egy kisebb azonosítójú esemény később válik láthatóvá.
 * Sorrend: előbb a szakasz sorzára, utána ez — minden írás ugyanígy, ezért nincs holtpont.
 */
export async function recordEvent(tx: Tx, actor: Actor, input: EventInput) {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
	const [row] = await tx
		.insert(event)
		.values({
			projectId: input.projectId,
			actorId: actor.userId,
			actorKind: actor.kind,
			type: input.type,
			targetType: input.targetType,
			targetId: input.targetId,
			summary: input.summary,
			data: input.data ?? {}
		})
		.returning({ id: event.id });
	await tx.execute(
		sql`select pg_notify(${EVENT_CHANNEL}, ${JSON.stringify({ projectId: input.projectId, eventId: row.id })})`
	);
	return row.id;
}
