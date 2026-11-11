import type { SubmitFunction } from '$app/forms';

export interface Toast {
	id: number;
	kind: 'ok' | 'error';
	text: string;
}

let next = 1;
export const toasts = $state<Toast[]>([]);

export function toast(text: string, kind: Toast['kind'] = 'ok') {
	const id = next++;
	toasts.push({ id, kind, text });
	setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}

/**
 * use:enhance segéd: a művelet üzenetét (ok / error) értesítésként mutatja, és frissít.
 * `reset: false` – az űrlap tartalma megmarad (pl. hibánál).
 */
export const withToast =
	(opts: { reset?: boolean; onDone?: () => void } = {}): SubmitFunction =>
	() =>
	async ({ result, update }) => {
		if (result.type === 'success' && result.data?.ok) toast(String(result.data.ok));
		if (result.type === 'failure' && result.data?.error) toast(String(result.data.error), 'error');
		if (result.type === 'error') toast(result.error?.message ?? 'Váratlan hiba.', 'error');
		await update({ reset: opts.reset ?? result.type === 'success' });
		if (result.type === 'success' || result.type === 'redirect') opts.onDone?.();
	};
