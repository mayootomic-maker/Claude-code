// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Lint rules for the interface.
 *
 * This file did not exist, so `pnpm lint` had never once run — a script in package.json that
 * exits 2 on every invocation is a check nobody was getting, presented as one they were.
 *
 * The rule set is deliberately narrow. Style is settled by the code review that already happens
 * here; what a linter is worth in this codebase is catching the two things review misses at
 * scale — a floating promise, and a value that was allowed to be `any` on its way to a chart.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  // No separate `@eslint/js` dependency: typescript-eslint's own recommended set already
  // includes the core rules, and adding a package to import a list that arrives anyway is a
  // dependency for nothing.
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The product rule, enforced mechanically. `?? 0` on a measurement is how "we never read
      // this" becomes "we read zero", which is the single failure the honesty invariants exist
      // to prevent — and the one a reviewer skims past because it looks defensive.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // An unawaited promise in a settings handler means a change that silently never happened.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // An `any` reaching a chart takes every guarantee upstream of it with it.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // Tests reach into shapes on purpose — a hostile message, a half-built settings object — and
    // the point of most of them is that the code survives exactly what the type system forbids.
    files: ['**/*.test.ts', 'shots/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    // This file, last so it wins. Type-aware rules need a project containing the file being
    // linted, and a config file does not belong inside the app's own program — so it is checked
    // without type information rather than forced into a tsconfig for the sake of the linter.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
  },
);
