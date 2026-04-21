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
    poolOptions: {
      forks: {
        // Reuse worker processes across files to amortize v8 + onnx warmup.
        // Each fork still isolates from the others, but we stop paying the
        // per-file fork-spawn cost (~50-100ms each across 37 files).
        singleFork: false,
      },
    },
    // Skip the test-isolation reload between files in the same worker.
    // Our tests use per-test tmp dirs + explicit engine/layer close(), so
    // shared-module state (constants, schemas) is safe to keep across files
    // and saves on module re-evaluation + esm graph re-import per file.
    isolate: false,
  },
});
