/** A CSS-változó tényleges színe (a light-dark() értékét is feloldja), a mermaidnek kell. */
function resolveColor(varName: string) {
	const el = document.createElement('span');
	el.style.color = `var(${varName})`;
	el.style.display = 'none';
	document.body.appendChild(el);
	const c = getComputedStyle(el).color;
	el.remove();
	return c;
}

/**
 * A ```mermaid kódblokkokat a böngészőben ábrává alakítja (lustán töltött mermaid).
 * `rerender`: a már kirajzolt ábrákat is újrarajzolja (témaváltáskor).
 */
export async function renderMermaid(root: HTMLElement | undefined, rerender = false) {
	if (!root) return;
	const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')].map((code) => ({
		el: code.parentElement!,
		src: code.textContent ?? ''
	}));
	if (rerender) {
		for (const div of root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-src]')) {
			blocks.push({ el: div, src: div.dataset.src ?? '' });
		}
	}
	if (!blocks.length) return;
	const { default: mermaid } = await import('mermaid');
	const c = (n: string) => resolveColor(n);
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: 'base',
		themeVariables: {
			fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--sans').trim(),
			fontSize: '14px',
			background: c('--surface'),
			primaryColor: c('--teal-wash'),
			primaryTextColor: c('--ink'),
			primaryBorderColor: c('--teal'),
			secondaryColor: c('--claude-wash'),
			tertiaryColor: c('--sunken'),
			lineColor: c('--graphite'),
			textColor: c('--ink'),
			edgeLabelBackground: c('--surface'),
			clusterBkg: c('--paper'),
			clusterBorder: c('--rule-strong'),
			noteBkgColor: c('--mark-wash'),
			noteTextColor: c('--ink'),
			noteBorderColor: c('--mark')
		},
		flowchart: { curve: 'basis', padding: 14 }
	});
	for (const [i, b] of blocks.entries()) {
		try {
			const { svg } = await mermaid.render(`mmd-${Date.now()}-${i}`, b.src);
			const div = document.createElement('div');
			div.className = 'mermaid-diagram';
			div.dataset.src = b.src;
			div.innerHTML = svg;
			b.el.replaceWith(div);
		} catch {
			b.el.classList.add('mermaid-error');
		}
	}
}
