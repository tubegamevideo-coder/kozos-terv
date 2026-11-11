import { createTwoFilesPatch, diffLines } from 'diff';

const withNl = (s: string) => (s === '' || s.endsWith('\n') ? s : s + '\n');

/** Unified diff két szövegállapot között, fejléc nélküli „===” sorral; üres, ha nincs eltérés. */
export function unifiedDiff(oldText: string, newText: string, oldLabel: string, newLabel: string) {
	if (oldText === newText) return '';
	return createTwoFilesPatch(oldLabel, newLabel, withNl(oldText), withNl(newText), '', '', {
		context: 2
	})
		.split('\n')
		.filter((l) => !l.startsWith('====='))
		.join('\n')
		.trimEnd();
}

/** Hányszor fordul elő `needle` a `haystack`-ben (átfedés nélkül). */
export function countOccurrences(haystack: string, needle: string) {
	if (!needle) return 0;
	let count = 0;
	let i = haystack.indexOf(needle);
	while (i !== -1) {
		count++;
		i = haystack.indexOf(needle, i + needle.length);
	}
	return count;
}

export interface DiffLine {
	type: 'add' | 'del' | 'ctx';
	text: string;
}

/** Soronkénti különbség a felülethez (hozzáadott / törölt / változatlan sorok). */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
	const out: DiffLine[] = [];
	for (const part of diffLines(withNl(oldText), withNl(newText))) {
		const type = part.added ? 'add' : part.removed ? 'del' : 'ctx';
		const lines = part.value.replace(/\n$/, '').split('\n');
		for (const text of lines) out.push({ type, text });
	}
	return out;
}
