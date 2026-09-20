import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const root = dirname(fileURLToPath(import.meta.url));
const unused = {
    args: 'all',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
    ignoreRestSiblings: true,
};

export default defineConfig(
    {
        name: 'yzforge/ignored-files',
        ignores: [
            '**/node_modules/**',
            '**/generated/**',
            '**/*.d.ts',
            'library/**',
            'temp/**',
            'local/**',
            'build/**',
            'native/**',
            'profiles/**',
            'settings/**',
            'coverage/**',
            '.yzforge/**',
            '.agents/**',
            '.codex/**',
            '.creator/**',
        ],
    },
    {
        name: 'yzforge/javascript-and-typescript',
        files: ['**/*.{js,mjs,cjs,ts}'],
        extends: [js.configs.recommended],
        languageOptions: { ecmaVersion: 2022 },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: {
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-debugger': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['error', unused],
        },
    },
    {
        name: 'yzforge/typescript',
        files: ['**/*.ts'],
        extends: [tseslint.configs.recommended],
        languageOptions: { parserOptions: { ecmaFeatures: { legacyDecorators: true } } },
        rules: { '@typescript-eslint/no-unused-vars': ['error', unused] },
    },
    {
        name: 'yzforge/runtime-type-aware-checks',
        files: ['assets/**/*.ts'],
        languageOptions: {
            parserOptions: { project: './tsconfig.json', tsconfigRootDir: root },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
        },
    },
    {
        name: 'yzforge/node-tools-and-tests',
        files: ['*.mjs', 'tools/**/*.{js,cjs,mjs}', 'tests/**/*.{ts,js,cjs,mjs}', 'extensions/**/*.js'],
        languageOptions: { globals: globals.node },
    },
    {
        name: 'yzforge/creator-commonjs',
        files: ['extensions/yzforge-editor/*.js', 'tools/**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },
    {
        name: 'yzforge/creator-editor-globals',
        files: ['extensions/yzforge-editor/*.js'],
        languageOptions: { globals: { Editor: 'readonly' } },
    },
    {
        name: 'yzforge/creator-panel-globals',
        files: ['extensions/yzforge-editor/panel.js'],
        languageOptions: { globals: globals.browser },
    },
    {
        name: 'yzforge/creator-scene-globals',
        files: ['extensions/yzforge-editor/scene.js'],
        languageOptions: { globals: { cce: 'readonly' } },
    },
    {
        name: 'yzforge/test-fixtures',
        files: ['tests/**/*.ts'],
        // Tests deliberately build partial contexts and malformed external input.
        rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    prettier,
);
