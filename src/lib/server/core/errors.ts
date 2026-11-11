export type CoreErrorCode =
	| 'NOT_FOUND'
	| 'FORBIDDEN'
	| 'VALIDATION'
	| 'STALE_REVISION'
	| 'SECTION_LOCKED'
	| 'PROTECTED_DOCUMENT'
	| 'EDIT_NO_MATCH'
	| 'EDIT_AMBIGUOUS'
	| 'IN_TRASH'
	| 'PROPOSAL_NOT_OPEN'
	| 'PROPOSAL_CONFLICT'
	| 'HUMAN_ONLY';

/**
 * A közös mag egyetlen hibatípusa. A `code` stabil (az MCP-réteg és a felület erre ágazik el),
 * az `message` magyar, a `details` pedig annyit ad vissza, amennyiből a Claude újra tud tervezni.
 */
export class CoreError extends Error {
	constructor(
		public readonly code: CoreErrorCode,
		message: string,
		public readonly details: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'CoreError';
	}
}

export const isCoreError = (e: unknown, code?: CoreErrorCode): e is CoreError =>
	e instanceof CoreError && (code === undefined || e.code === code);
