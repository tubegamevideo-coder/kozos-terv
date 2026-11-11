export const fmt = (d: Date | string | null | undefined) =>
	d ? new Date(d).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) : '–';

export const viaLabel = (v: string) => (v === 'claude' ? 'Claude' : 'kézzel');

export const kindLabel = (k: string) =>
	({ main_plan: 'fő terv', note: 'jegyzet', research: 'kutatás', decision_log: 'döntésnapló' })[k] ?? k;

export const questionStatusLabel = (s: string) =>
	({ open: 'nyitott', disputed: 'vitatott', decided: 'eldőlt' })[s] ?? s;

export const ideaStatusLabel = (s: string) =>
	({ new: 'új', investigating: 'vizsgálandó', adopted: 'beemelve', rejected: 'elvetve' })[s] ?? s;
