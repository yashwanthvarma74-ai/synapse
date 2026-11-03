import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// The server is plain Node and TypeScript. This is the recommended rule set plus the two checks that catch the
// mistakes this code is most exposed to: an async call nobody waits for, and a promise used where a value is.
export default tseslint.config(
  { ignores: ['node_modules/**', 'bench/results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // a leading underscore marks an argument that is required by the signature but not used (Express error handlers)
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
    },
  },
)
