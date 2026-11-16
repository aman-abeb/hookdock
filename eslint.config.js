import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Flat ESLint config: JavaScript recommended + TypeScript recommended. */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
