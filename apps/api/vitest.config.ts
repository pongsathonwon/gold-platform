import { defineConfig } from "vitest/config";

// Usecase-level tests only — no database. Every dependency a usecase reaches for is either a
// `Context.Tag` or a single factory module, so the ports can be swapped for in-memory fakes and
// the domain logic runs unchanged. See src/test/README.md for what that does and does not cover.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
