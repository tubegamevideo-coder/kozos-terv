import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildMcpServer } from '../src/lib/server/mcp/server';
import { handleMcpRequest } from '../src/lib/server/mcp/http';
import { devActorResolver, parseDevTokens } from '../src/lib/server/auth/dev';
import { readSection } from '../src/lib/server/core';
import type { Db } from '../src/lib/server/db';
import { claude, human, seed, useDb } from './helpers';

const { db } = useDb();

async function connect(db: Db, userId: string) {
	const server = buildMcpServer(db, claude(userId));
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'teszt', version: '1' });
	await Promise.all([server.connect(a), client.connect(b)]);
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
		return { isError: !!r.isError, text: r.content.map((c) => c.text).join('\n') };
	};
	const json = async (name: string, args: Record<string, unknown> = {}) => {
		const r = await call(name, args);
		if (r.isError) throw new Error(r.text);
		return JSON.parse(r.text);
	};
	return { client, call, json };
}

const EXPECTED_TOOLS = [
	'add_comment', 'add_idea', 'add_question', 'create_document', 'create_section', 'edit_section',
	'get_changes', 'get_project_brief', 'list_comments', 'list_ideas', 'list_projects', 'list_questions',
	'lock_section', 'log_decision', 'propose_change', 'read_document', 'read_section', 'release_section',
	'replace_section', 'search', 'trash_section', 'update_question', 'vote_idea', 'withdraw_proposal'
];

describe('MCP-eszközök', () => {
	it('mind a 24 eszköz és a 3 prompt elérhető, leírással és bemeneti sémával', async () => {
		const s = await seed(db);
		const { client } = await connect(db, s.kollega.id);
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
		for (const t of tools) {
			expect(t.description!.length).toBeGreaterThan(40);
			expect(t.inputSchema.type).toBe('object');
		}
		const { prompts } = await client.listPrompts();
		expect(prompts.map((p) => p.name).sort()).toEqual(['kritikus_atnezes', 'mi_tortent', 'otleteles']);
		expect(client.getInstructions()).toContain('get_project_brief');
	});

	it('teljes munkamenet: összefoglaló → olvasás → írás; elavult revízióra olvasható hiba diffel', async () => {
		const s = await seed(db);
		const kollega = await connect(db, s.kollega.id);
		const levente = await connect(db, s.levente.id);

		const projects = await kollega.json('list_projects');
		expect(projects[0]).toMatchObject({ name: 'Pályázatfigyelő', role: 'editor' });

		const brief = await kollega.json('get_project_brief', { projectId: s.project.id });
		expect(brief.documents[0].sections[0]).toMatchObject({ title: 'Ötletek', revision: 1 });

		const sec = await kollega.call('read_section', { sectionId: s.noteSec.sectionId });
		expect(sec.text).toContain('## Ötletek');
		expect(sec.text).toContain('revision: 1');
		expect(sec.text).toContain('Második sor.');

		// Levente Claude-ja közben ír
		await levente.json('edit_section', {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			oldText: 'Első sor.',
			newText: 'Első sor – Levente.',
			reason: 'pontosítás'
		});
		// a kolléga Claude-ja a régi revízióból írna
		const stale = await kollega.call('edit_section', {
			sectionId: s.noteSec.sectionId,
			baseRevision: 1,
			oldText: 'Harmadik sor.',
			newText: 'Harmadik sor, bővítve.',
			reason: 'bővítés'
		});
		expect(stale.isError).toBe(true);
		expect(stale.text).toContain('HIBA STALE_REVISION');
		expect(stale.text).toContain('```diff');
		expect(stale.text).toContain('+Első sor – Levente.');
		expect(stale.text).toContain('A szakasz mostani tartalma:');
		expect(stale.text).toContain('"by": "Levente"');

		// újrapróbálás a friss revízióval
		const retry = await kollega.json('edit_section', {
			sectionId: s.noteSec.sectionId,
			baseRevision: 2,
			oldText: 'Harmadik sor.',
			newText: 'Harmadik sor, bővítve.',
			reason: 'bővítés'
		});
		expect(retry.revision).toBe(3);
		const final = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(final.content).toBe('Első sor – Levente.\nMásodik sor.\nHarmadik sor, bővítve.');

		// Levente következő összefoglalója mutatja a kolléga Claude-jának írását
		const lb = await levente.json('get_project_brief', { projectId: s.project.id });
		expect(lb.changesSinceLastVisit.items.some((e: { by: string; via: string; type: string }) =>
			e.by === 'Kollega' && e.via === 'claude' && e.type === 'section.edited')).toBe(true);
	});

	it('zár: a másik Claude SECTION_LOCKED-et kap, megjegyzést viszont tehet', async () => {
		const s = await seed(db);
		const levente = await connect(db, s.levente.id);
		const kollega = await connect(db, s.kollega.id);
		await levente.json('lock_section', { sectionId: s.noteSec.sectionId, purpose: 'átstrukturálom' });
		const r = await kollega.call('replace_section', { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' });
		expect(r.isError).toBe(true);
		expect(r.text).toContain('HIBA SECTION_LOCKED');
		expect(r.text).toContain('Levente');
		expect(r.text).toContain('átstrukturálom');
		const c = await kollega.call('add_comment', { sectionId: s.noteSec.sectionId, body: 'Ha kész vagy, szólj.' });
		expect(c.isError).toBe(false);
		await levente.json('release_section', { sectionId: s.noteSec.sectionId });
		const ok = await kollega.call('replace_section', { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' });
		expect(ok.isError).toBe(false);
	});

	it('védett dokumentum: közvetlen írás helyett javaslat; meglévőhöz és új szakaszhoz is', async () => {
		const s = await seed(db);
		const k = await connect(db, s.kollega.id);
		const direct = await k.call('replace_section', { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'x', reason: 'r' });
		expect(direct.text).toContain('HIBA PROTECTED_DOCUMENT');
		expect(direct.text).toContain('propose_change');

		const p1 = await k.json('propose_change', { sectionId: s.planSec.sectionId, baseRevision: 1, content: 'Új cél.', reason: 'pontosabb' });
		expect(p1.diff).toContain('+Új cél.');
		const p2 = await k.json('propose_change', { documentId: s.plan.id, title: 'Kockázatok', content: '- adatforrás', reason: 'hiányzik' });
		expect(p2.proposalId).toBeTruthy();
		const bad = await k.call('propose_change', { content: 'x', reason: 'r' });
		expect(bad.text).toContain('HIBA VALIDATION');

		const doc = await k.call('read_document', { documentId: s.plan.id, full: true });
		expect(doc.text).toContain('"isProtected": true');
		expect(doc.text).toContain('nyitott javaslat: 1');
		expect(doc.text).toContain('"openNewSectionProposals": 1');
		const w = await k.json('withdraw_proposal', { proposalId: p2.proposalId });
		expect(w.status).toBe('rejected');
	});

	it('ötlet, kérdés, döntés és keresés eszközökkel', async () => {
		const s = await seed(db);
		const k = await connect(db, s.kollega.id);
		await k.json('add_idea', { projectId: s.project.id, title: 'Heti összefoglaló e-mail', tags: ['értesítés'] });
		const ideas = await k.json('list_ideas', { projectId: s.project.id });
		await k.json('vote_idea', { ideaId: ideas[0].id, value: 1 });
		const q = await k.json('add_question', { projectId: s.project.id, title: 'Milyen gyakran értesítsünk?' });
		const d = await k.json('log_decision', { projectId: s.project.id, title: 'Gyakoriság', decision: 'hetente', questionId: q.id });
		expect(d.questionDecided).toBe(true);
		const qs = await k.json('list_questions', { projectId: s.project.id, status: ['decided'] });
		expect(qs[0]).toMatchObject({ title: 'Milyen gyakran értesítsünk?', decision: 'hetente' });
		const found = await k.json('search', { projectId: s.project.id, query: 'hetente' });
		expect(found.sections[0].documentTitle).toBe('Döntésnapló');
	});

	it('nem tag projektjéhez nem fér hozzá', async () => {
		const s = await seed(db);
		const x = await connect(db, s.idegen.id);
		expect(await x.json('list_projects')).toEqual([]);
		const r = await x.call('get_project_brief', { projectId: s.project.id });
		expect(r.text).toContain('HIBA NOT_FOUND');
	});

	it('sémahiba esetén is értelmes válasz jön', async () => {
		const s = await seed(db);
		const k = await connect(db, s.kollega.id);
		const r = await k.call('edit_section', { sectionId: s.noteSec.sectionId, oldText: 'x', newText: 'y', reason: 'r' });
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/baseRevision/);
	});
});

describe('/mcp HTTP-végpont (fejlesztői token)', () => {
	const TOKEN = 'teszt-token-legalabb-24-karakter-hosszu';

	it('token nélkül 401 WWW-Authenticate fejléccel; GET 405', async () => {
		await seed(db);
		const resolveActor = devActorResolver(db, parseDevTokens(`${TOKEN}=levente@example.test`));
		const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		const r = await handleMcpRequest(
			new Request('http://localhost/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
			{ db, resolveActor }
		);
		expect(r.status).toBe(401);
		expect(r.headers.get('www-authenticate')).toMatch(/^Bearer/);
		const bad = await handleMcpRequest(
			new Request('http://localhost/mcp', { method: 'POST', body, headers: { authorization: 'Bearer rossz-token-ami-eleg-hosszu-is' } }),
			{ db, resolveActor }
		);
		expect(bad.status).toBe(401);
		const g = await handleMcpRequest(new Request('http://localhost/mcp'), { db, resolveActor });
		expect(g.status).toBe(405);
	});

	it('valódi Streamable HTTP-klienssel végigmegy, és Levente nevében, Claude-jelöléssel ír', async () => {
		const s = await seed(db);
		const resolveActor = devActorResolver(db, parseDevTokens(`${TOKEN}=levente@example.test`));
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) =>
			handleMcpRequest(new Request(input, init), { db, resolveActor })) as typeof fetch;
		const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
			fetch: fetchImpl,
			requestInit: { headers: { authorization: `Bearer ${TOKEN}` } }
		});
		const client = new Client({ name: 'http-teszt', version: '1' });
		await client.connect(transport);
		const { tools } = await client.listTools();
		expect(tools).toHaveLength(EXPECTED_TOOLS.length);
		const r = (await client.callTool({
			name: 'replace_section',
			arguments: { sectionId: s.noteSec.sectionId, baseRevision: 1, content: 'HTTP-ről', reason: 'próba' }
		})) as { isError?: boolean; content: { text: string }[] };
		expect(r.isError).toBeFalsy();
		const sec = await readSection(db, human(s.levente.id), s.noteSec.sectionId);
		expect(sec.content).toBe('HTTP-ről');
		await client.close();
	});

	it('rövid tokent nem fogad el a konfiguráció', () => {
		expect(() => parseDevTokens('rovid=a@b.c')).toThrow(/24 karakter/);
	});
});
