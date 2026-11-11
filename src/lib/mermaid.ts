/** A ```mermaid kódblokkokat a böngészőben ábrává alakítja (lustán töltött mermaid). */
export async function renderMermaid(root: HTMLElement | undefined) {
	if (!root) return;
	const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
	if (!blocks.length) return;
	const { default: mermaid } = await import('mermaid');
	const dark = matchMedia('(prefers-color-scheme: dark)').matches;
	mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' });
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
