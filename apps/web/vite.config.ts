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

/**
 * Splits the framework away from the app's own code.
 *
 * Routes are already lazy (`App.tsx`), which took the entry chunk from 739 KB to ~583 KB. What is
 * left is almost entirely libraries, and they are on a completely different release cadence from
 * this app: shipping a fix to a retail page should not make an operator re-download React, MUI and
 * Emotion. Assets are served with a one-year immutable cache under content-hashed names, so a
 * chunk that does not change is a chunk that is never fetched again.
 *
 * The groups are acyclic by construction — `mui`, `router` and `query` all depend on `react` and
 * none depends on another — which is what keeps Rollup from emitting chunks that reference each
 * other before initialisation. Do not fold two of these together without re-running the smoke test.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/.test(id)) return "react";
  if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "router";
  if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "query";
  return undefined;
}

export default defineConfig(({ mode }) => {
  requireApiUrl(mode);
  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        output: { manualChunks: vendorChunk },
      },
    },
    test: {
      environment: "node",
    },
  };
});
