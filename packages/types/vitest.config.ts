import { defineConfig } from "vitest/config";

// Pure functions only — this package has no I/O of any kind.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
