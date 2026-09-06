import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The planner walks the full 1.21.4 recipe graph on first load; that costs
    // a couple of seconds before any assertion runs.
    testTimeout: 30_000,
  },
})
