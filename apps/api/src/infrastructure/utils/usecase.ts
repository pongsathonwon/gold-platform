import { Exit } from "effect";

export type AppReturnShape<T, E> = Promise<Exit.Exit<T, E>>