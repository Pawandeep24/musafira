import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: { resolve: { conditions: ["musafira-source"] } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
