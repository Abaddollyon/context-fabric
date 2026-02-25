import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/server.ts',  // MCP protocol handler — tested via live MCP, not unit tests
        'src/setup.ts',   // CLI config generation — tested via live MCP context.setup
        'src/time.ts',    // Timezone operations — tested via live MCP context.time
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    maxConcurrency: 5,
    pool: 'forks',
  },
});
