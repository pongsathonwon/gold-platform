import { Hono } from "hono";
import { appRuntime } from "../../../infrastructure/runtime.js";
import { UserManagementUseCase, } from "../application/user.usecase.js";
import { Cause, Exit } from "effect";
import { z } from "zod";

const userManager = new UserManagementUseCase(appRuntime);

export const usersRouter = new Hono()
  .get("/", async (c) => {
    const result = await userManager.findAllUser();
    if (Exit.isSuccess(result)) {
      return c.json({ users: result.value }, 200)
    }
    if (!Cause.isFailType(result.cause)) {
      return c.json({ error: 'Internal system fault', details: String(result.cause) }, 500)
    }
    switch (result.cause.error._tag) {
      case "DatabaseConnectionError": return c.json({ error: 'db connection error' }, 500)
      case "DrizzleInitializeError": return c.json({ error: 'drizzle error' }, 500)
      case "UnknownException": return c.json({ error: 'libs error error' }, 500)
      case "ConfigError": return c.json({ error: 'cannot load config error' }, 500)
      case "RepositoryError": return c.json({ error: 'queringlogic error' }, 500)
    }

  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const parsingResult = z.coerce.number().safeParse(id);
    if (parsingResult.error) {
      return c.json({ error: parsingResult.error.message }, 400)
    }
    const result = await userManager.findUserById(parsingResult.data)
    if (Exit.isSuccess(result)) {
      return c.json({ user: result.value }, 200)
    }
    if (!Cause.isFailType(result.cause)) {
      return c.json({ error: 'Internal system fault', details: String(result.cause) }, 500)
    }
    switch (result.cause.error._tag) {
      case "DatabaseConnectionError": return c.json({ error: 'db connection error' }, 500)
      case "DrizzleInitializeError": return c.json({ error: 'drizzle error' }, 500)
      case "UnknownException": return c.json({ error: 'libs error error' }, 500)
      case "ConfigError": return c.json({ error: 'cannot load config error' }, 500)
      case "RepositoryError": return c.json({ error: 'queringlogic error' }, 500)
      case "UserNotFoundError": return c.json({ error: 'user not found' }, 404)
    }
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const parsingResult = z.coerce.number().safeParse(id);
    if (parsingResult.error) {
      return c.json({ error: parsingResult.error.message }, 400)
    }
    const result = await userManager.deleteUserById(parsingResult.data)
    if (Exit.isSuccess(result)) {
      return c.json({ user: result.value }, 200)
    }
    if (!Cause.isFailType(result.cause)) {
      return c.json({ error: 'Internal system fault', details: String(result.cause) }, 500)
    }
    switch (result.cause.error._tag) {
      case "DatabaseConnectionError": return c.json({ error: 'db connection error' }, 500)
      case "DrizzleInitializeError": return c.json({ error: 'drizzle error' }, 500)
      case "UnknownException": return c.json({ error: 'libs error error' }, 500)
      case "ConfigError": return c.json({ error: 'cannot load config error' }, 500)
      case "RepositoryError": return c.json({ error: 'quering logic error' }, 500)
      case "UserNotFoundError": return c.json({ error: 'user not found' }, 404)
    }
  });
