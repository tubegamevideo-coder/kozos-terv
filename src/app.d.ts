// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user: { id: string; name: string; email: string; image: string | null } | null;
		}
	}
}

export {};
