import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import type { PublicUser } from "../../domain/user/user.entity.js";
import type { IUserRepository } from "../../domain/user/user.repository.js";

type RegisterInput = { name: string; email: string; password: string };

export async function registerUseCase(
  repo: IUserRepository,
  input: RegisterInput,
  jwtSecret: string
): Promise<{ token: string; user: PublicUser }> {
  const existing = await repo.findByEmail(input.email);
  if (existing) throw Object.assign(new Error("Email already in use"), { code: "EMAIL_TAKEN" });

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await repo.create({ name: input.name, email: input.email, passwordHash });

  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await sign({ sub: user.id, email: user.email, exp }, jwtSecret, "HS256");

  return { token, user: { id: user.id, name: user.name, email: user.email } };
}
