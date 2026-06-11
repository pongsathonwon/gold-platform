import { AuthResponse, LoginInput, RegisterInput } from "@gold-platform/types";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { RepositoryError } from "../../../infrastructure/db/client.js";
import { TBaseError } from "../../../infrastructure/runtime.js";
import { InvalidCredentialsError, DuplicateEmailError } from "../domain/auth.error.js";
import { UnknownException } from "effect/Cause";

type PossibleAuthError = RepositoryError | UnknownException

export interface ForAuthentication {
    login(req: LoginInput): AppReturnShape<AuthResponse, PossibleAuthError | InvalidCredentialsError | TBaseError>
    register(req: RegisterInput): AppReturnShape<AuthResponse, PossibleAuthError | DuplicateEmailError | TBaseError>
}
