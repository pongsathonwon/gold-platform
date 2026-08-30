/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * `VITE_API_URL` is inlined into the bundle at build time, which makes getting it wrong uniquely
 * quiet: the build succeeds, the deploy succeeds, the page loads, and every request goes to a host
 * that is not the API. Nothing fails until someone tries to log in.
 *
 * That is not hypothetical — a production bundle was built and deployed pointing at
 * http://localhost:3000, because `apps/web/.env` supplied that value and `.env` applies to builds as
 * well as to the dev server. The dev value now lives in `.env.development`, which `vite build` does
 * not read, so a build has no API URL unless one is stated. This refuses to produce a bundle in that
 * case rather than emitting one that is broken in a way no test would catch.
 *
 * Building against a local API is still fine — say so explicitly:
 *   VITE_API_URL=http://localhost:3000 pnpm --filter @gold-platform/web build
 */
function requireApiUrl(mode: string): void {
  if (mode !== "production") return;

  const url = loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL;
  if (!url) {
    throw new Error(
      "VITE_API_URL is not set, and it is baked into the bundle at build time.\n" +
      "  Deploying:  VITE_API_URL=https://your-api pnpm --filter @gold-platform/web build\n" +
      "  Local API:  VITE_API_URL=http://localhost:3000 pnpm --filter @gold-platform/web build\n" +
      "The dev server needs none of this — it reads .env.development.",
    );
  }
}

export default defineConfig(({ mode }) => {
  requireApiUrl(mode);
  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
    test: {
      environment: "node",
    },
  };
});
