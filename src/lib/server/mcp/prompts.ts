import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const user = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

/** Kész munkamenetek: a claude.ai-ban a „+” menüből, Claude Code-ban /-parancsként érhetők el. */
export function registerPrompts(server: McpServer) {
	server.registerPrompt(
		'mi_tortent',
		{
			title: 'Mi történt, mióta nem voltam itt?',
			description: 'Összefoglalja a többiek változásait az utolsó látogatás óta.',
			argsSchema: { projekt: z.string().optional().describe('A projekt neve (ha több van)') }
		},
		({ projekt }) =>
			user(
				`Nézd meg Terézben${projekt ? ` a(z) „${projekt}” projektet` : ' a projektemet (ha több van, kérdezz)'}: hívd a get_project_brief-et, és foglald össze röviden, mi változott a többiektől, mióta nem voltam itt. Emeld ki a nekem szóló nyitott javaslatokat, a vitatott kérdéseket és az aktív zárakat. Ne változtass semmit.`
			)
	);

	server.registerPrompt(
		'otleteles',
		{
			title: 'Ötletelés egy kérdésről',
			description: 'Ötletek gyűjtése egy témáról, add_idea-val rögzítve.',
			argsSchema: { tema: z.string().describe('Miről ötleteljünk?') }
		},
		({ tema }) =>
			user(
				`Ötleteljünk Terézben erről: „${tema}”. Előbb hívd a get_project_brief-et és nézd meg a meglévő ötleteket (list_ideas), hogy ne ismételjünk. Aztán adj 5–8 változatos ötletet röviden; amelyiket jóváhagyom, azt rögzítsd add_idea-val, címkével. A dokumentumokba most ne írj.`
			)
	);

	server.registerPrompt(
		'kritikus_atnezes',
		{
			title: 'Kritikus átnézés egy dokumentumról',
			description: 'Gyenge pontok, ellentmondások és hiányok keresése; megjegyzésként vagy javaslatként.',
			argsSchema: { dokumentum: z.string().describe('A dokumentum címe') }
		},
		({ dokumentum }) =>
			user(
				`Nézd át kritikusan a(z) „${dokumentum}” dokumentumot Terézben (get_project_brief, majd read_document full: true). Keress ellentmondásokat, hiányzó döntéseket, kockázatokat és homályos részeket. Előbb listázd nekem őket fontossági sorrendben; amit jóváhagyok, azt megjegyzésként (add_comment) vagy – védett dokumentumnál – javaslatként (propose_change) rögzítsd. A nyitott kérdéseket vedd fel add_question-nel.`
			)
	);
}
