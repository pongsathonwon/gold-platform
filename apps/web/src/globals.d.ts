// Needed so TypeScript can typecheck the API's source files when resolving
// the Hono RPC AppType (import type from @gold-platform/api).
declare const process: { env: Record<string, string | undefined> };
