import type { User } from "../../domain/user/user.entity.js";
import type { IUserRepository } from "../../domain/user/user.repository.js";

export async function deleteUserUseCase(repo: IUserRepository, id: number): Promise<User | null> {
  return repo.deleteById(id);
}
