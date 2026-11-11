import type { RequestHandler } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { humanActor, orError } from '../../../../../lib/server/web';
import { loadProject } from '../../../../../lib/server/core/access';
import { subscribe } from '../../../../../lib/server/live';

/** Server-Sent Events: a projekt minden új eseményéről szól (a böngésző ekkor frissít). */
export const GET: RequestHandler = async ({ locals, url, params, request }) => {
	const actor = humanActor(locals, url);
	await orError(loadProject(getDb(), actor, params.projectId, 'viewer'));
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (s: string) => {
				try {
					controller.enqueue(enc.encode(s));
				} catch {
					cleanup();
				}
			};
			send('retry: 5000\n\n');
			// A saját, felületről tett módosításunkról nem szólunk (azt már látjuk); a saját Claude-unkéról igen.
			const unsubscribe = await subscribe(params.projectId, (ev) => {
				if (ev.actorId === actor.userId && ev.actorKind === 'human') return;
				send(`id: ${ev.eventId}\ndata: ${ev.eventId}\n\n`);
			});
			// Életjel, hogy a proxyk (Cloudflare) ne zárják le a tétlen kapcsolatot.
			const ping = setInterval(() => send(': ping\n\n'), 25_000);
			cleanup = () => {
				clearInterval(ping);
				unsubscribe();
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					/* már zárva */
				}
			});
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
};
