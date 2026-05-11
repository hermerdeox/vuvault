import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: ts.parser
		}
	},
	{
		files: ['**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parser: ts.parser
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		ignores: [
			'.svelte-kit/**',
			'.wrangler/**',
			'build/**',
			'node_modules/**',
			'static/**',
			'docs/**',
			'**/*.cjs'
		]
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_|^err$' }
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-empty': ['warn', { allowEmptyCatch: true }],
			// Relaxed: SvelteKit 2 typed-routing rules apply when wiring into typed
			// `$app/paths` resolve() helpers. The current scaffold uses static
			// string paths, which is canonical SvelteKit. Re-enable post-P0 when
			// we adopt the typed-routes API.
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/no-useless-mustaches': 'off',
			'svelte/no-useless-children-snippet': 'off'
		}
	}
);
