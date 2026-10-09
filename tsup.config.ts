import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    target: 'node22',
    platform: 'node',
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: false,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    splitting: false,
    sourcemap: false,
  },
]);
