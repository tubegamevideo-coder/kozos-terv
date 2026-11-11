import { EventEmitter } from 'node:events';
import postgres from 'postgres';
import { EVENT_CHANNEL } from './core/events';

/**
 * Élő frissítés: folyamatonként egyetlen LISTEN-kapcsolat a Postgreshez; az események
 * projekt szerint szétosztva mennek az SSE-feliratkozóknak.
 */
export interface LiveEvent {
	projectId: string;
	eventId: number;
	actorId: string;
	actorKind: 'human' | 'claude';
}

const bus = new EventEmitter();
bus.setMaxListeners(0);
let started: Promise<void> | null = null;

function start() {
	if (started) return started;
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL nincs beállítva');
	const listener = postgres(url, { max: 1, onnotice: () => {} });
	started = listener
		.listen(EVENT_CHANNEL, (payload) => {
			try {
				const ev = JSON.parse(payload) as LiveEvent;
				bus.emit(ev.projectId, ev);
			} catch {
				/* hibás üzenet: kihagyjuk */
			}
		})
		.then(() => undefined)
		.catch((e) => {
			started = null;
			throw e;
		});
	return started;
}

export async function subscribe(projectId: string, onEvent: (ev: LiveEvent) => void) {
	await start();
	bus.on(projectId, onEvent);
	return () => bus.off(projectId, onEvent);
}
