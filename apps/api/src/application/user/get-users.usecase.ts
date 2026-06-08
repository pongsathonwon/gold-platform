import type { User } from "../../domain/user/user.entity.js";
import type { IUserRepository } from "../../domain/user/user.repository.js";

export async function getUsersUseCase(repo: IUserRepository): Promise<User[]> {
  return repo.findAll();
}
