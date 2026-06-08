import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);

export function loadOptionalEnv<T>(schema: z.Schema<T>): T | null {
  const result = schema.safeParse(process.env);
  return result.success ? result.data : null;
}
