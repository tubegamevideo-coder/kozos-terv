export type ActorKind = 'human' | 'claude';

/** Ki hívja a magot: a belépett felhasználó, közvetlenül (web) vagy a Claude-ján keresztül (MCP). */
export interface Actor {
	userId: string;
	kind: ActorKind;
}

export type Role = 'owner' | 'editor' | 'viewer';

/** Óra, amit a tesztek átállíthatnak (zárlejárat). */
export const clock = {
	now: (): Date => new Date()
};

export const LOCK_DEFAULT_MINUTES = 20;
export const LOCK_MAX_MINUTES = 120;
