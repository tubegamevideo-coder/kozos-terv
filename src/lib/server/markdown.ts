import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const marked = new Marked({ gfm: true, breaks: false });

/**
 * Markdown → biztonságos HTML (szerveroldalon). A ```mermaid blokkokat a böngésző rajzolja ki
 * (pre > code.language-mermaid). Minden más HTML-t szűrünk: a tartalmat Claude-ok és emberek írják.
 */
export function renderMarkdown(md: string) {
	const html = marked.parse(md ?? '', { async: false }) as string;
	return sanitizeHtml(html, {
		allowedTags: [
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'span',
			'ul', 'ol', 'li', 'strong', 'em', 'del', 's', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
			'input', 'sup', 'sub', 'details', 'summary', 'kbd', 'img'
		],
		allowedAttributes: {
			a: ['href', 'title', 'rel', 'target'],
			code: ['class'],
			th: ['align'],
			td: ['align'],
			input: ['type', 'checked', 'disabled'],
			img: ['src', 'alt', 'title']
		},
		allowedClasses: { code: [/^language-[\w-]+$/] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesByTag: { img: ['https', 'data'] },
		transformTags: {
			a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true)
		}
	});
}
