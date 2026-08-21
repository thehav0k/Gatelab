import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Node only. src/lib is pure by construction (see eslint.config.mjs), so the
    // engine suite needs no jsdom and no React plugin — it runs in milliseconds.
    environment: "node",
    include: ["src/lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/lib/utils.ts", "**/*.test.ts"],
      // A ratchet, not a target. These are set to what the suite actually
      // achieves so that a regression fails the build. The uncovered branches are
      // overwhelmingly defensive guards that `noUncheckedIndexedAccess` forces us
      // to write but that are unreachable by construction (`?? 0`, `if (!node)
      // continue`); testing those would be testing the type system.
      thresholds: { lines: 97, functions: 96, branches: 84, statements: 96 },
    },
  },
});
