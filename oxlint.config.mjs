import { defineConfig } from 'oxlint';

export default defineConfig({
  jsPlugins: [{ name: 'boundaries', specifier: 'eslint-plugin-boundaries' }],
  overrides: [
    {
      files: ['src/config/**/*.ts'],
      rules: {
        'boundaries/no-unknown': 'off',
      },
    },
    {
      files: ['src/test/**/*.ts'],
      rules: {
        'boundaries/no-unknown': 'off',
      },
    },
    {
      files: ['**/*.test.ts'],
      rules: {
        'boundaries/no-unknown': 'off',
        'boundaries/element-types': 'off',
      },
    },
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
      },
    },
    'boundaries/elements': [
      { type: 'commands', pattern: 'src/commands/*/**', capture: ['command'] },
      { type: 'cli', pattern: 'src/cli/**' },
      { type: 'model', pattern: 'src/model/**' },
      { type: 'services', pattern: 'src/services/**' },
      { type: 'lib', pattern: 'src/lib/**' },
      { type: 'config', pattern: 'src/config/**' },
      { type: 'env', pattern: 'src/env.*' },
      { type: 'test', pattern: 'src/test/**' },
    ],
  },
  rules: {
    'oxc/no-barrel-file': ['error', { threshold: 0 }],
    'boundaries/no-unknown': 'error',
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        message: 'Layer violation: invalid import for current layer. Follow docs/architecture.md.',
        rules: [
          {
            from: 'commands',
            allow: [
              ['commands', { command: '${from.command}' }],
              'cli',
              'model',
              'services',
              'lib',
              'config',
            ],
          },
          {
            from: 'model',
            allow: ['model', 'lib', 'config'],
          },
          {
            from: 'cli',
            allow: ['cli', 'lib'],
          },
          {
            from: 'services',
            allow: ['services', 'model', 'lib', 'config'],
          },
          {
            from: 'lib',
            allow: ['lib', 'config'],
          },
          {
            from: 'config',
            allow: ['config', 'lib', 'env'],
          },
          {
            from: 'test',
            allow: ['test', 'cli', 'commands', 'model', 'services', 'lib', 'config', 'env'],
          },
        ],
      },
    ],
  },
});
