import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'bin/', 'templates/', '*.config.*'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // `sync --check` must be read-only. Directory creation is the one write that does not go
    // through `commitPlannedWrite`, so the sync engine may only create directories via
    // `ensurePlannedDir`, which no-ops under check mode. Without this, the next adapter to
    // reach for `ensureDir`/`mkdirSync` silently reintroduces the bug (see issue #242) — and a
    // fixture-driven test cannot catch it, because an adapter whose sources are not seeded
    // never runs.
    files: ['src/sync/**/*.ts'],
    ignores: ['src/sync/pipeline.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../utils/fs.js',
              importNames: ['ensureDir'],
              message:
                'Use ensurePlannedDir(ctx, dir) from ./pipeline.js — ensureDir is not check-mode aware and breaks the read-only guarantee of `sync --check`.',
            },
            {
              name: 'node:fs',
              importNames: ['mkdirSync'],
              message:
                'Use ensurePlannedDir(ctx, dir) from ./pipeline.js — a bare mkdirSync breaks the read-only guarantee of `sync --check`.',
            },
          ],
        },
      ],
    },
  },
);
