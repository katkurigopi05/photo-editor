import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@director/canonical-json": pkg("packages/canonical-json/src/index.ts"),
      "@director/project-schema": pkg("packages/project-schema/src/index.ts"),
      "@director/command-schema": pkg("packages/command-schema/src/index.ts"),
      "@director/editor-state": pkg("packages/editor-state/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
  },
});
