import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		strictPort: true
	},
	build: {
		target: 'esnext',
		sourcemap: true
	},
	test: {
		include: [
			'src/**/*.{test,spec}.{js,ts}',
			'tests/integration/**/*.{test,spec}.{js,ts}'
		],
		environment: 'node',
		globals: false
	}
});
