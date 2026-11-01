// ESLint flat config for apps/api. Minimal: typescript-eslint recommended rules.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'public/**', 'supabase/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Supabase and Strava rows are untyped JSON by design; typing them all is a separate job.
      '@typescript-eslint/no-explicit-any': 'off',
      // A leading underscore marks a parameter kept on purpose (stubs, fixed callback signatures).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
