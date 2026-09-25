// @ts-check

import { globalIgnores } from 'eslint/config'
import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  globalIgnores([
    '.output/',
    'dist/',
  ]),

  ...tanstackConfig,

  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },

  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
