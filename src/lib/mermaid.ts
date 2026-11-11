/** A ```mermaid kódblokkokat a böngészőben ábrává alakítja (lustán töltött mermaid). */
export async function renderMermaid(root: HTMLElement | undefined) {
	if (!root) return;
	const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
	if (!blocks.length) return;
	const { default: mermaid } = await import('mermaid');
	// Az ábrák a felület színeit kapják (papír, tus, zöldeskék vonalak).
	const css = getComputedStyle(document.documentElement);
	const v = (n: string) => css.getPropertyValue(n).trim();
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: 'base',
		themeVariables: {
			fontFamily: v('--sans'),
			fontSize: '14px',
			background: v('--surface'),
			primaryColor: v('--teal-wash'),
			primaryTextColor: v('--ink'),
			primaryBorderColor: v('--teal'),
			secondaryColor: v('--teal-wash'),
			tertiaryColor: v('--claude-wash'),
			lineColor: v('--graphite'),
			textColor: v('--ink'),
			edgeLabelBackground: v('--surface'),
			clusterBkg: v('--paper'),
			clusterBorder: v('--rule'),
			noteBkgColor: v('--mark-wash'),
			noteTextColor: v('--ink'),
			noteBorderColor: v('--mark')
		},
		flowchart: { curve: 'basis', padding: 14 }
	});
	for (const [i, code] of blocks.entries()) {
		const pre = code.parentElement!;
		try {
			const { svg } = await mermaid.render(`mmd-${Date.now()}-${i}`, code.textContent ?? '');
			const div = document.createElement('div');
			div.className = 'mermaid-diagram';
			div.innerHTML = svg;
			pre.replaceWith(div);
		} catch {
			pre.classList.add('mermaid-error');
		}
	}
}
