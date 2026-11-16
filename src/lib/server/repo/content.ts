import { gitlabBase, type RepoProvider } from './ref';

export interface FileContext {
	provider: RepoProvider;
	repo: string;
	path: string;
	/** Az ág; ha nincs, a webes címekben az alapértelmezett ág (`HEAD`). */
	ref?: string;
}

const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
const MERMAID = new Set(['mmd', 'mermaid']);
const LANG: Record<string, string> = {
	ts: 'ts',
	js: 'js',
	mjs: 'js',
	cjs: 'js',
	json: 'json',
	yml: 'yaml',
	yaml: 'yaml',
	sql: 'sql',
	py: 'python',
	sh: 'bash',
	bash: 'bash',
	toml: 'toml',
	svelte: 'svelte',
	html: 'html',
	css: 'css',
	dockerfile: 'dockerfile',
	env: 'bash',
	txt: 'text'
};

const extOf = (path: string) => {
	const base = path.split('/').pop() ?? path;
	if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
	const i = base.lastIndexOf('.');
	return i > 0 ? base.slice(i + 1).toLowerCase() : '';
};

const baseName = (path: string) => path.split('/').pop() ?? path;

/** Elég hosszú kódkerítés, hogy a fájlban lévő ``` ne zárja le. */
function fence(text: string, lang: string) {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
	const f = '`'.repeat(Math.max(3, longest + 1));
	return `${f}${lang}\n${text.replace(/\n+$/, '')}\n${f}`;
}

const encodePath = (p: string) =>
	p
		.split('/')
		.map((s) => {
			try {
				return encodeURIComponent(decodeURIComponent(s));
			} catch {
				return encodeURIComponent(s);
			}
		})
		.join('/');

/** A repó webes fájl- és nyers címének alapja, perjellel a végén. */
export function webBases(ctx: FileContext) {
	const ref = encodePath(ctx.ref || 'HEAD');
	if (ctx.provider === 'github') {
		return { blob: `https://github.com/${ctx.repo}/blob/${ref}/`, raw: `https://github.com/${ctx.repo}/raw/${ref}/` };
	}
	const base = gitlabBase();
	return { blob: `${base}/${ctx.repo}/-/blob/${ref}/`, raw: `${base}/${ctx.repo}/-/raw/${ref}/` };
}

/** Relatív út feloldása a fájl mappájához képest; a repó gyökerénél nem megy feljebb. */
export function resolveRepoPath(fromFile: string, rel: string) {
	const parts = rel.startsWith('/') ? [] : fromFile.split('/').slice(0, -1);
	for (const p of rel.replace(/^\/+/, '').split('/')) {
		if (p === '' || p === '.') continue;
		if (p === '..') parts.pop();
		else parts.push(p);
	}
	return parts.join('/');
}

const isRelative = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('#') && !url.startsWith('//');

function absolutize(url: string, ctx: FileContext, image: boolean) {
	if (!isRelative(url)) return url;
	const cut = url.search(/[?#]/);
	const pathPart = cut === -1 ? url : url.slice(0, cut);
	const suffix = cut === -1 ? '' : url.slice(cut);
	const target = resolveRepoPath(ctx.path, pathPart);
	const { blob, raw } = webBases(ctx);
	return `${image ? raw : blob}${encodePath(target)}${suffix}`;
}

/**
 * A relatív linkeket és képeket a repó webes címére irányítja, hogy Terézben is működjenek.
 * Kódblokkon belül nem nyúl semmihez.
 */
export function rewriteRelativeLinks(md: string, ctx: FileContext) {
	let inFence: string | null = null;
	return md
		.split('\n')
		.map((line) => {
			const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (f) {
				if (!inFence) inFence = f[1];
				else if (f[1][0] === inFence[0] && f[1].length >= inFence.length) inFence = null;
				return line;
			}
			if (inFence) return line;
			const def = line.match(/^(\s{0,3}\[[^\]]+\]:\s*)(<?)(\S+?)(>?)(\s.*)?$/);
			if (def) return `${def[1]}${def[2]}${absolutize(def[3], ctx, false)}${def[4]}${def[5] ?? ''}`;
			return line.replace(/(!?)\[([^\]]*)\]\(\s*(<?)([^)\s>]+)(>?)((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g, (_m, bang, text, lt, url, gt, title) =>
				`${bang}[${text}](${lt}${absolutize(url, ctx, bang === '!')}${gt}${title})`
			);
		})
		.join('\n');
}

/**
 * Egy repófájl szövegéből a szakasz címe és Markdown-tartalma.
 * - Markdown: az első `#` címsor lesz a cím (ha van), a front matter elmarad, a relatív linkek a repóra mutatnak.
 * - `.mmd`: Mermaid-ábra. Más szöveges fájl: kódblokk a nyelv jelölésével.
 */
export function fileToSection(text: string, ctx: FileContext): { title: string; content: string } {
	const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
	const ext = extOf(ctx.path);

	if (MERMAID.has(ext)) return { title: baseName(ctx.path), content: fence(src, 'mermaid') };
	if (!MARKDOWN.has(ext)) return { title: baseName(ctx.path), content: fence(src, LANG[ext] ?? '') };

	let body = src;
	const fm = body.match(/^---\n[\s\S]*?\n---\n/);
	if (fm) body = body.slice(fm[0].length);
	let title = baseName(ctx.path).replace(/\.(md|markdown|mdx)$/i, '');
	const h1 = body.match(/^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/);
	if (h1) {
		title = h1[1].trim();
		body = body.slice(h1[0].length);
	}
	body = body.replace(/^\n+/, '').replace(/\s+$/, '');
	return { title, content: rewriteRelativeLinks(body, ctx) };
}
