import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(32),
});

// Throws at startup if required vars are missing — fail fast with a clear error.
export const env = envSchema.parse(process.env);

// Use this only for truly optional env vars that have a safe fallback.
export function loadOptionalEnv<T>(schema: z.Schema<T>): T | null {
  const result = schema.safeParse(process.env);
  return result.success ? result.data : null;
}

export const loadDbEnv = loadOptionalEnv(envSchema)