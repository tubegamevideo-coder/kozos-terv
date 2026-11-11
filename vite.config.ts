import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// A SvelteKit beépített CSRF-ellenőrzése a szerverek közti OAuth-kéréseket (token,
			// register) is tiltaná, mert azokon nincs Origin fejléc. Helyette a hooks.server.ts
			// ellenőrzi az Origin-t minden sütis, állapotot módosító kérésnél.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
