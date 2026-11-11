import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CoreError } from '../core/errors';

/** Dátumokat ISO-szövegként, undefined/null mezők nélkül – tömör, de olvasható JSON. */
export function toJson(value: unknown) {
	return JSON.stringify(
		value,
		(_k, v) => (v === null || v === undefined ? undefined : v instanceof Date ? v.toISOString() : v),
		1
	);
}

export const ok = (value: unknown): CallToolResult => ({
	content: [{ type: 'text', text: typeof value === 'string' ? value : toJson(value) }]
});

/**
 * CoreError → eszközhiba, amiből a Claude újra tud tervezni. A hosszú szöveges részleteket
 * (friss tartalom, diff) nem JSON-escape-elve, hanem külön blokkban adjuk vissza.
 */
export function fromError(e: unknown): CallToolResult {
	if (e instanceof CoreError) {
		const { currentContent, diff, ...rest } = e.details as Record<string, unknown>;
		const parts = [`HIBA ${e.code}: ${e.message}`];
		if (Object.keys(rest).length) parts.push(toJson(rest));
		if (typeof diff === 'string' && diff) parts.push('Különbség az általad olvasott és a mostani változat között:\n```diff\n' + diff + '\n```');
		if (typeof currentContent === 'string') parts.push('A szakasz mostani tartalma:\n```markdown\n' + currentContent + '\n```');
		return { isError: true, content: [{ type: 'text', text: parts.join('\n\n') }] };
	}
	console.error('[mcp] váratlan hiba', e);
	return {
		isError: true,
		content: [{ type: 'text', text: 'HIBA INTERNAL: váratlan szerverhiba. Próbáld újra; ha ismétlődik, szólj a felhasználónak.' }]
	};
}

export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
	try {
		return ok(await fn());
	} catch (e) {
		return fromError(e);
	}
}

/** Egy szakasz Markdownként, fejléccel – ezt a Claude könnyebben olvassa, mint egy JSON-ba escape-elt szöveget. */
export function sectionBlock(s: {
	id: string;
	title: string;
	revision: number;
	content?: string;
	lock?: { heldBy: string; expiresAt: string; purpose?: string } | null;
	openProposals?: number | unknown[];
}) {
	const meta = [`id: ${s.id}`, `revision: ${s.revision}`];
	if (s.lock) meta.push(`ZÁROLVA: ${s.lock.heldBy}, ${s.lock.expiresAt}-ig${s.lock.purpose ? ` (${s.lock.purpose})` : ''}`);
	const n = Array.isArray(s.openProposals) ? s.openProposals.length : s.openProposals;
	if (n) meta.push(`nyitott javaslat: ${n}`);
	return `## ${s.title}\n<!-- ${meta.join(' · ')} -->\n\n${s.content ?? ''}`.trimEnd();
}
