import { Data } from "effect";

export class DuplicateEmailError extends Data.TaggedError("DuplicateEmailError") {}
export class InvalidCredentialsError extends Data.TaggedError("InvalidCredentialsError")<{ message: string }> {}
