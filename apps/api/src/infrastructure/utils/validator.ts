import { Data, Effect } from "effect";
import {z} from "zod";

export class ValidationError extends Data.TaggedError("ValidationError")<{ message: string }> {}

export const validateWith = <T>(
  schema: z.Schema<T>,
): ((req: unknown) => Effect.Effect<T, ValidationError>) => (req: unknown) => {
  const result = schema.safeParse(req);
  return result.success
    ? Effect.succeed(result.data)
    : Effect.fail(
        new ValidationError({
          message: `validation error: ${result.error.message}`,
        }),
      );
};