import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import type { PublicUser } from "../../domain/user/user.entity.js";
import type { IUserRepository } from "../../domain/user/user.repository.js";

type LoginInput = { email: string; password: string };

export async function loginUseCase(
  repo: IUserRepository,
  input: LoginInput,
  jwtSecret: string
): Promise<{ token: string; user: PublicUser }> {
  const user = await repo.findByEmail(input.email);
  if (!user) throw Object.assign(new Error("Invalid credentials"), { code: "INVALID_CREDENTIALS" });

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw Object.assign(new Error("Invalid credentials"), { code: "INVALID_CREDENTIALS" });

  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await sign({ sub: user.id, email: user.email, exp }, jwtSecret, "HS256");

  return { token, user: { id: user.id, name: user.name, email: user.email } };
}
