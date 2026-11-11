import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from '../db';
import * as core from '../core';
import type { Actor } from '../core';
import { ok, run, sectionBlock, fromError, toJson } from './format';
import { registerPrompts } from './prompts';

export const SERVER_INSTRUCTIONS = `Közös tervezőapp: több ember a saját Claude-jával tervez ugyanazon a projekten. A szerver védi a munkát az egymás közti felülírástól – ezt használd ki, ne kerüld meg.

Munkamenet:
1. Kezdd a get_project_brief hívással (ha nem tudod a projekt azonosítóját: list_projects). Tartsd be a benne lévő projektutasítást (instructions), és mondd el a felhasználónak röviden, mi változott a többiektől az utolsó látogatása óta.
2. Írás előtt olvasd el, amit módosítasz (read_section vagy read_document), és jegyezd meg a revíziószámot. Minden írásnál add meg baseRevision-ként.
3. Kis módosításhoz edit_section (keresés-csere) kell, zár nélkül. Több lépéses átíráshoz előbb lock_section, a végén release_section.
4. Ha STALE_REVISION hibát kapsz, valaki közben írt: a válaszban ott a friss tartalom és a különbség. Építsd bele a munkádat a friss változatba, és az új revízióval próbáld újra. Soha ne írd felül vakon a más munkáját.
5. Ha SECTION_LOCKED hibát kapsz, a szakaszon más dolgozik: tegyél megjegyzést (add_comment), vagy dolgozz máson, és szólj a felhasználónak.
6. Védett dokumentumba (isProtected: true, általában a „fő terv”) nem írhatsz közvetlenül: propose_change-dzsel javasolj, egy ember fogadja el.
7. Minden íráshoz adj rövid, emberi indoklást (reason): a többiek ebből látják, miért változott valami.
8. Ötleteket add_idea-val, nyitott kérdéseket add_question-nel, meghozott döntéseket log_decision-nel rögzíts; ne zsúfold őket a dokumentumokba.
A szakaszok Markdownt tartalmaznak (táblázat, Mermaid-ábra is lehet). Az azonosítókat (id) ne mutasd a felhasználónak, ha nem kéri.`;

const id = (what: string) => z.string().min(1).describe(`${what} azonosítója`);
const reason = z
	.string()
	.min(1)
	.describe('Rövid, emberi indoklás: miért változtatsz (a revízióba kerül, a többiek látják)');
const baseRevision = z
	.number()
	.int()
	.min(1)
	.describe('Az a revíziószám, amelyet utoljára olvastál (read_section / read_document adja)');

/**
 * Az MCP-szerver egy felhasználóhoz kötve. Állapotmentes: kérésenként épül fel, a hívó (Claude)
 * mindig az `actor` nevében dolgozik, `claude` jelöléssel.
 */
export function buildMcpServer(db: Db, actor: Actor) {
	const server = new McpServer(
		{ name: 'kozos-terv', title: 'Közös tervezőapp', version: '0.2.0' },
		{ instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, prompts: {} } }
	);
	const ro = { readOnlyHint: true, openWorldHint: false } as const;
	const rw = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

	// ------------------------------------------------------------ tájékozódás

	server.registerTool(
		'list_projects',
		{
			title: 'Projektjeim',
			description:
				'A felhasználó összes projektje (munkaterenként), szerepkörrel és a mások által tett, még nem látott változások számával. Akkor hívd, ha nem tudod, melyik projekten dolgoztok.',
			inputSchema: {},
			annotations: ro
		},
		async () => run(() => core.listProjects(db, actor, { channel: 'mcp' }))
	);

	server.registerTool(
		'create_project',
		{
			title: 'Új projekt',
			description:
				'Új projekt létrehozása, ha a felhasználó kéri. Adj neki rövid nevet és egymondatos célt; a projektutasítást (a Claude-oknak szóló szabályokat) csak ember állíthatja a felületen. Ha a felhasználónak több munkatere van, add meg a munkatér nevét (workspace). Utána create_document-tel indíthatod a dokumentumokat.',
			inputSchema: {
				name: z.string().min(1).describe('A projekt neve'),
				goal: z.string().optional().describe('A cél egy mondatban'),
				workspace: z.string().optional().describe('A munkatér neve (csak ha több van)')
			},
			annotations: rw
		},
		async (a) =>
			run(async () => {
				const all = await core.listMyWorkspaces(db, actor.userId);
				const writable = all.filter((w) => w.role !== 'viewer');
				const pick = a.workspace
					? writable.filter((w) => w.name.toLowerCase() === a.workspace!.trim().toLowerCase())
					: writable;
				if (pick.length !== 1) {
					throw new core.CoreError(
						'VALIDATION',
						pick.length ? 'Több munkatér van, add meg, melyikben (workspace).' : 'Nincs ilyen munkatér, ahol projektet hozhatnál létre.',
						{ workspaces: writable.map((w) => w.name) }
					);
				}
				const p = await core.createProject(db, actor, { workspaceId: pick[0].id, name: a.name, goal: a.goal });
				return { projectId: p.id, name: p.name, workspace: pick[0].name };
			})
	);

	server.registerTool(
		'get_project_brief',
		{
			title: 'Projekt-összefoglaló',
			description:
				'Minden beszélgetés elején hívd. Egy hívásban: a projektutasítás (tartsd be!), a dokumentumok és szakaszok tartalomjegyzéke revíziószámokkal, nyitott kérdések, aktív zárak, nyitott javaslatok és a többiek változásai a felhasználó legutóbbi (Claude-os) látogatása óta. A hívás a változásokat látottnak jelöli, így a következő összefoglaló csak az újakat mutatja.',
			inputSchema: {
				projectId: id('A projekt'),
				markSeen: z.boolean().optional().describe('Alapból true. False esetén nem jelöli látottnak a változásokat.')
			},
			annotations: { ...ro, idempotentHint: false }
		},
		async (a) => run(() => core.getProjectBrief(db, actor, { projectId: a.projectId, channel: 'mcp', markSeen: a.markSeen }))
	);

	server.registerTool(
		'get_changes',
		{
			title: 'Változások',
			description:
				'A projekt eseménynaplója időrendben: ki (ember vagy Claude), mit, min, mikor. Kurzorral lapozható (afterEventId = az előző válasz nextCursor-ja), vagy időponttól (since). Nem jelöl semmit látottnak.',
			inputSchema: {
				projectId: id('A projekt'),
				afterEventId: z.number().int().min(0).optional().describe('Ennél nagyobb azonosítójú események'),
				since: z.string().datetime({ offset: true }).optional().describe('ISO-időpont, ettől kezdve'),
				limit: z.number().int().min(1).max(200).optional()
			},
			annotations: ro
		},
		async (a) =>
			run(() =>
				core.getChanges(db, actor, {
					projectId: a.projectId,
					afterEventId: a.afterEventId,
					since: a.since ? new Date(a.since) : undefined,
					limit: a.limit
				})
			)
	);

	server.registerTool(
		'search',
		{
			title: 'Keresés',
			description:
				'Teljes szöveges keresés a projektben (magyar szótövezéssel): szakaszok kiemelt részlettel (« »), valamint kérdések és ötletek. A találat sectionId-jével olvasd tovább a read_section-nel.',
			inputSchema: {
				projectId: id('A projekt'),
				query: z.string().min(1).describe('Keresőkifejezés; idézőjel, OR és -kizárás is használható'),
				limit: z.number().int().min(1).max(50).optional()
			},
			annotations: ro
		},
		async (a) => run(() => core.searchProject(db, actor, a))
	);

	// ------------------------------------------------------------ olvasás

	server.registerTool(
		'read_document',
		{
			title: 'Dokumentum olvasása',
			description:
				'Egy dokumentum szakaszai sorrendben, revíziószámmal és zárral. Alapból vázlat (cím + első mondat) – ez spórol a kontextussal; full: true esetén a teljes Markdown. Ha csak néhány szakasz kell, add meg a sectionIds-t.',
			inputSchema: {
				documentId: id('A dokumentum'),
				full: z.boolean().optional().describe('Teljes tartalom (alapból false: csak vázlat)'),
				sectionIds: z.array(z.string()).optional().describe('Csak ezek a szakaszok')
			},
			annotations: ro
		},
		async (a) => {
			try {
				const d = await core.readDocument(db, actor, a);
				const head = toJson({
					id: d.id,
					title: d.title,
					kind: d.kind,
					isProtected: d.isProtected,
					openNewSectionProposals: d.openNewSectionProposals || undefined
				});
				if (!a.full) return ok({ ...JSON.parse(head), sections: d.sections });
				const body = d.sections.map((s) => sectionBlock(s)).join('\n\n');
				return ok(`${head}\n\n# ${d.title}\n\n${body}`);
			} catch (e) {
				return fromError(e);
			}
		}
	);

	server.registerTool(
		'read_section',
		{
			title: 'Szakasz olvasása',
			description:
				'Egy szakasz teljes Markdown-tartalma, aktuális revíziószáma, zárja és nyitott javaslatai. Írás előtt mindig ezt (vagy a read_document full-t) hívd, és a kapott revíziót add meg baseRevision-ként. includeHistory: a revíziók listája (ki, mikor, miért).',
			inputSchema: {
				sectionId: id('A szakasz'),
				includeHistory: z.boolean().optional()
			},
			annotations: ro
		},
		async (a) => {
			try {
				const s = await core.readSection(db, actor, a.sectionId);
				const meta = {
					document: { id: s.documentId, title: s.documentTitle, isProtected: s.isProtected },
					inTrash: s.inTrash || undefined,
					openProposals: s.openProposals.length ? s.openProposals : undefined,
					history: a.includeHistory ? await core.listRevisions(db, actor, a.sectionId) : undefined
				};
				return ok(`${toJson(meta)}\n\n${sectionBlock(s)}`);
			} catch (e) {
				return fromError(e);
			}
		}
	);

	// ------------------------------------------------------------ írás

	server.registerTool(
		'edit_section',
		{
			title: 'Szakasz célzott módosítása',
			description:
				'Keresés-csere egy szakaszon belül: az oldText pontosan egyszer szerepeljen a szakaszban (karakterre egyezzen, sortörésekkel együtt), és newText-re cserélődik. Ez az alapértelmezett írási mód; kis változtatáshoz nem kell zár. Előtte read_section, a revíziót add meg baseRevision-ként. Védett dokumentumban nem működik: ott propose_change.',
			inputSchema: {
				sectionId: id('A szakasz'),
				baseRevision,
				oldText: z.string().min(1).describe('A cserélendő, pontosan egyszer előforduló szövegrészlet'),
				newText: z.string().describe('Az új szöveg (üres = törlés)'),
				reason
			},
			annotations: rw
		},
		async (a) => run(() => core.editSection(db, actor, a))
	);

	server.registerTool(
		'replace_section',
		{
			title: 'Szakasz teljes cseréje',
			description:
				'A szakasz teljes tartalmát (és opcionálisan a címét) lecseréli. Nagyobb átíráshoz; előtte érdemes lock_section-nel lefoglalni. baseRevision kötelező. Védett dokumentumban nem működik: ott propose_change.',
			inputSchema: {
				sectionId: id('A szakasz'),
				baseRevision,
				title: z.string().optional().describe('Új cím (ha nincs megadva, marad a régi)'),
				content: z.string().describe('A szakasz teljes új Markdown-tartalma (a címsor nélkül)'),
				reason
			},
			annotations: rw
		},
		async (a) => run(() => core.replaceSection(db, actor, a))
	);

	server.registerTool(
		'create_section',
		{
			title: 'Új szakasz',
			description:
				'Új szakasz egy dokumentumba, a megadott szakasz után (afterSectionId), vagy a végére. A tartalom Markdown, a cím külön mezőben (ne ismételd meg címsorként). Védett dokumentumban propose_change kell (documentId-vel).',
			inputSchema: {
				documentId: id('A dokumentum'),
				title: z.string().min(1),
				content: z.string().optional(),
				afterSectionId: z.string().optional().describe('Ez után a szakasz után (alapból a dokumentum végére)'),
				reason
			},
			annotations: rw
		},
		async (a) => run(() => core.createSection(db, actor, a))
	);

	server.registerTool(
		'trash_section',
		{
			title: 'Szakasz lomtárba',
			description:
				'Lomtárba teszi a szakaszt (visszaállítható, semmi nem vész el). Csak ha a felhasználó kéri, vagy összevonás után a régi szakasz feleslegessé vált. baseRevision kötelező.',
			inputSchema: { sectionId: id('A szakasz'), baseRevision, reason },
			annotations: { ...rw, destructiveHint: true }
		},
		async (a) => run(() => core.trashSection(db, actor, a))
	);

	server.registerTool(
		'create_document',
		{
			title: 'Új dokumentum',
			description:
				'Új dokumentum a projektben. kind: „note” (jegyzet, szabadon írható), „research” (kutatás), „main_plan” (fő terv – mindig védett, oda csak javasolni lehet), „decision_log” (döntésnapló; inkább a log_decision-t használd). Utána create_section-nel töltsd fel.',
			inputSchema: {
				projectId: id('A projekt'),
				title: z.string().min(1),
				kind: z.enum(['note', 'research', 'main_plan', 'decision_log']).optional()
			},
			annotations: rw
		},
		async (a) => run(() => core.createDocument(db, actor, a))
	);

	server.registerTool(
		'propose_change',
		{
			title: 'Javaslat',
			description:
				'Javaslat egy védett dokumentumhoz (de bárhol használható, ha a felhasználó jóváhagyást kér). Meglévő szakasz átírásához: sectionId + baseRevision + content (a teljes javasolt tartalom). Új szakasz javaslatához: documentId (+ afterSectionId) + title + content. Egy ember fogadja el vagy utasítja el a felületen; ha közben a szakasz megváltozik, a javaslat „ütközik” és újra kell alapozni.',
			inputSchema: {
				sectionId: z.string().optional().describe('Meglévő szakasz átírásához'),
				baseRevision: baseRevision.optional(),
				documentId: z.string().optional().describe('Új szakasz javaslatához'),
				afterSectionId: z.string().optional(),
				title: z.string().optional().describe('Új cím (meglévőnél opcionális, újnál kötelező)'),
				content: z.string().describe('A javasolt teljes Markdown-tartalom'),
				reason
			},
			annotations: rw
		},
		async (a) =>
			run(async () => {
				if (a.sectionId) {
					if (a.baseRevision === undefined) {
						throw new core.CoreError('VALIDATION', 'Meglévő szakaszhoz baseRevision is kell.');
					}
					return core.proposeChange(db, actor, {
						sectionId: a.sectionId,
						baseRevision: a.baseRevision,
						title: a.title,
						content: a.content,
						reason: a.reason
					});
				}
				if (!a.documentId || !a.title) {
					throw new core.CoreError('VALIDATION', 'Adj meg sectionId-t (átírás) vagy documentId-t és címet (új szakasz).');
				}
				return core.proposeNewSection(db, actor, {
					documentId: a.documentId,
					afterSectionId: a.afterSectionId,
					title: a.title,
					content: a.content,
					reason: a.reason
				});
			})
	);

	server.registerTool(
		'withdraw_proposal',
		{
			title: 'Saját javaslat visszavonása',
			description: 'Visszavonja a felhasználó saját nyitott vagy ütköző javaslatát (pl. újraalapozás előtt).',
			inputSchema: { proposalId: id('A javaslat'), note: z.string().optional() },
			annotations: rw
		},
		async (a) => run(() => core.rejectProposal(db, actor, a))
	);

	// ------------------------------------------------------------ zár

	server.registerTool(
		'lock_section',
		{
			title: 'Szakasz lefoglalása',
			description:
				'Lefoglalja a szakaszt több lépéses munkához (alapból 20 perc, max. 120; újrahívással meghosszabbítható). Amíg él, más nem írhat bele. A purpose-ban írd le röviden, mit csinálsz – a többiek látják. A munka végén release_section.',
			inputSchema: {
				sectionId: id('A szakasz'),
				minutes: z.number().int().min(1).max(120).optional(),
				purpose: z.string().min(1).describe('Mit csinálsz a szakasszal (a többiek látják)')
			},
			annotations: rw
		},
		async (a) => run(() => core.lockSection(db, actor, a))
	);

	server.registerTool(
		'release_section',
		{
			title: 'Zár feloldása',
			description: 'Feloldja a saját zárat, amint végeztél. Más zárját nem oldhatod fel.',
			inputSchema: { sectionId: id('A szakasz') },
			annotations: { ...rw, idempotentHint: true }
		},
		async (a) => run(() => core.releaseSection(db, actor, { sectionId: a.sectionId }))
	);

	// ------------------------------------------------------------ vita

	const target = {
		sectionId: z.string().optional(),
		questionId: z.string().optional(),
		proposalId: z.string().optional()
	};

	server.registerTool(
		'add_comment',
		{
			title: 'Megjegyzés',
			description:
				'Megjegyzés vagy válasz egy szakaszon, kérdésen vagy javaslaton (pontosan egyet adj meg). Zárolt és védett szakaszra is lehet – ha nem írhatsz bele, így jelezd az észrevételedet.',
			inputSchema: { ...target, body: z.string().min(1), parentId: z.string().optional().describe('Válasz erre a megjegyzésre') },
			annotations: rw
		},
		async (a) => run(() => core.addComment(db, actor, a))
	);

	server.registerTool(
		'list_comments',
		{
			title: 'Megjegyzések',
			description: 'Megjegyzésszálak egy szakaszon, kérdésen vagy javaslaton, válaszokkal. Alapból csak a nyitott szálak.',
			inputSchema: { ...target, includeResolved: z.boolean().optional() },
			annotations: ro
		},
		async (a) => run(() => core.listComments(db, actor, a))
	);

	// ------------------------------------------------------------ kérdések

	const qStatus = z.enum(['open', 'disputed', 'decided']);

	server.registerTool(
		'add_question',
		{
			title: 'Nyitott kérdés',
			description:
				'Nyitott kérdés felvétele, amit később el kell dönteni (pl. „Milyen adatforrásból dolgozzunk?”). relatedSectionIds: az érintett szakaszok.',
			inputSchema: {
				projectId: id('A projekt'),
				title: z.string().min(1),
				body: z.string().optional().describe('Háttér, lehetőségek'),
				relatedSectionIds: z.array(z.string()).optional()
			},
			annotations: rw
		},
		async (a) => run(() => core.addQuestion(db, actor, a))
	);

	server.registerTool(
		'list_questions',
		{
			title: 'Kérdések',
			description: 'A projekt kérdései állapot szerint (vitatott, nyitott, eldőlt), döntésekkel.',
			inputSchema: { projectId: id('A projekt'), status: z.array(qStatus).optional() },
			annotations: ro
		},
		async (a) => run(() => core.listQuestions(db, actor, a))
	);

	server.registerTool(
		'update_question',
		{
			title: 'Kérdés módosítása',
			description:
				'Kérdés állapota („open”, „disputed” = vitatott, „decided” = eldőlt), leírása vagy döntése. Eldőlt állapothoz döntés kell; ha a döntést a döntésnaplóba is rögzíteni kell, inkább log_decision-t hívj questionId-vel.',
			inputSchema: {
				questionId: id('A kérdés'),
				status: qStatus.optional(),
				decision: z.string().optional(),
				body: z.string().optional(),
				relatedSectionIds: z.array(z.string()).optional()
			},
			annotations: rw
		},
		async (a) => run(() => core.updateQuestion(db, actor, a))
	);

	// ------------------------------------------------------------ ötletek

	const iStatus = z.enum(['new', 'investigating', 'adopted', 'rejected']);

	server.registerTool(
		'add_idea',
		{
			title: 'Ötlet',
			description:
				'Gyors ötlet rögzítése ötleteléskor (rövid cím, opcionális kifejtés, címkék). Ötletenként egy hívás; a jó ötleteket később lehet beemelni egy szakaszba.',
			inputSchema: {
				projectId: id('A projekt'),
				title: z.string().min(1),
				body: z.string().optional(),
				tags: z.array(z.string()).optional()
			},
			annotations: rw
		},
		async (a) => run(() => core.addIdea(db, actor, a))
	);

	server.registerTool(
		'list_ideas',
		{
			title: 'Ötletek',
			description: 'A projekt ötletei szavazatok szerint rendezve (myVote: a felhasználó saját szavazata). Szűrhető állapotra és címkére.',
			inputSchema: { projectId: id('A projekt'), status: z.array(iStatus).optional(), tag: z.string().optional() },
			annotations: ro
		},
		async (a) => run(() => core.listIdeas(db, actor, a))
	);

	server.registerTool(
		'vote_idea',
		{
			title: 'Szavazás ötletre',
			description: 'A felhasználó nevében szavaz: 1 = támogatja, -1 = ellenzi, 0 = visszavonja. Csak ha a felhasználó kéri.',
			inputSchema: { ideaId: id('Az ötlet'), value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) },
			annotations: { ...rw, idempotentHint: true }
		},
		async (a) => run(() => core.voteIdea(db, actor, a))
	);

	// ------------------------------------------------------------ döntések

	server.registerTool(
		'log_decision',
		{
			title: 'Döntés rögzítése',
			description:
				'Meghozott döntés a projekt döntésnaplójába (mi, miért). Ha egy nyitott kérdést zár le, add meg a questionId-t: a kérdés „eldőlt” lesz. Csak akkor hívd, ha a felhasználó (vagy a csapat) tényleg döntött.',
			inputSchema: {
				projectId: id('A projekt'),
				title: z.string().min(1).describe('Rövid cím, pl. „Adatforrás”'),
				decision: z.string().min(1).describe('A döntés egy-két mondatban'),
				rationale: z.string().optional().describe('Miért így döntöttetek'),
				questionId: z.string().optional()
			},
			annotations: rw
		},
		async (a) => run(() => core.logDecision(db, actor, a))
	);

	registerPrompts(server);
	return server;
}
