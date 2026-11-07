import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      reporter: ["text", "lcov"],
      exclude: [
        "src/cli.js",
        "src/3mf/parser.js",
        "src/3mf/writer.js",
        "src/llm/optimizerClient.js",
        "src/llm/compactContext.js",
        "src/web/server.js",
        "src/web/api.js",
        "src/web/vercelHandler.js",
        "web/**/*",
        "dist/**/*",
        "eslint.config.js",
        "vitest.config.js",
        "api/**/*",
        "test/**/*",
        "src/config.js",
        "scripts/**/*",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
