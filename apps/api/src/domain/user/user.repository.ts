import type { User } from "./user.entity.js";

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: number): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: { name: string; email: string; passwordHash: string }): Promise<User>;
  deleteById(id: number): Promise<User | null>;
}
