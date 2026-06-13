import { AuthResponse, LoginInput, RegisterInput } from "@gold-platform/types";
import { Effect } from "effect";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { InvalidCredentialsError, DuplicateEmailError } from "../domain/auth.error.js";

export interface ForAuthentication {
    login(req: LoginInput): Effect.Effect<AuthResponse, RepositoryError | InvalidCredentialsError>
    register(req: RegisterInput): Effect.Effect<AuthResponse, RepositoryError | DuplicateEmailError>
}
