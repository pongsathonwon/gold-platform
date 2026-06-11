import { Data } from "effect";

export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{ id: number }> {}
