import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '../../../../../lib/server/db/client';
import { humanActor, orError } from '../../../../../lib/server/web';
import { searchProject } from '../../../../../lib/server/core';

export const GET: RequestHandler = async ({ locals, url, params }) => {
	const actor = humanActor(locals, url);
	const q = url.searchParams.get('q') ?? '';
	if (q.trim().length < 2) return json({ sections: [], questions: [], ideas: [] });
	return json(await orError(searchProject(getDb(), actor, { projectId: params.projectId, query: q, limit: 12 })));
};
