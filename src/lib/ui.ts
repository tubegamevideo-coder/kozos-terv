const rtf = new Intl.RelativeTimeFormat('hu', { numeric: 'auto' });

/** „5 perce”, „tegnap”, vagy dátum, ha régebbi egy hétnél. */
export function ago(d: Date | string | null | undefined) {
	if (!d) return '–';
	const t = new Date(d).getTime();
	const diff = (t - Date.now()) / 1000;
	const abs = Math.abs(diff);
	if (abs < 45) return 'az imént';
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
	if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
	return fmtDate(d);
}

export const fmt = (d: Date | string | null | undefined) =>
	d ? new Date(d).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }) : '–';

export const fmtDate = (d: Date | string | null | undefined) =>
	d ? new Date(d).toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }) : '–';

export const timeOnly = (d: Date | string) => new Date(d).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });

/** Nap szerinti csoportfejléc: „Ma”, „Tegnap”, vagy dátum. */
export function dayLabel(d: Date | string) {
	const x = new Date(d);
	const today = new Date();
	const y = new Date();
	y.setDate(today.getDate() - 1);
	if (x.toDateString() === today.toDateString()) return 'Ma';
	if (x.toDateString() === y.toDateString()) return 'Tegnap';
	return x.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
}

export const kindLabel = (k: string) =>
	({ main_plan: 'Fő terv', note: 'Jegyzet', research: 'Kutatás', decision_log: 'Döntésnapló' })[k] ?? k;

export const roleLabel = (r: string) => ({ owner: 'tulajdonos', editor: 'szerkesztő', viewer: 'olvasó' })[r] ?? r;

export const questionStatusLabel = (s: string) => ({ open: 'Nyitott', disputed: 'Vitatott', decided: 'Eldőlt' })[s] ?? s;

export const ideaStatusLabel = (s: string) =>
	({ new: 'Új', investigating: 'Vizsgáljuk', adopted: 'Beemelve', rejected: 'Elvetve' })[s] ?? s;

/** Felhasználónként állandó, visszafogott szín (a név alapján). */
const HUES = [172, 205, 25, 330, 95, 260, 45, 145];
export function personHue(name: string) {
	let h = 0;
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return HUES[h % HUES.length];
}

export const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join('') || '?';
