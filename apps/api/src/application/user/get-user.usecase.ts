import type { User } from "../../domain/user/user.entity.js";
import type { IUserRepository } from "../../domain/user/user.repository.js";

export async function getUserUseCase(repo: IUserRepository, id: number): Promise<User | null> {
  return repo.findById(id);
}
