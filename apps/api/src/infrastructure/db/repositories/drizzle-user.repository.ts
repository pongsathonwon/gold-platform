import { eq } from "drizzle-orm";
import type { User } from "../../../domain/user/user.entity.js";
import type { IUserRepository } from "../../../domain/user/user.repository.js";
import { db } from "../client.js";
import { users } from "../schema/user.schema.js";

export class DrizzleUserRepository implements IUserRepository {
  async findAll(): Promise<User[]> {
    return db.select().from(users);
  }

  async findById(id: number): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ?? null;
  }

  async create(data: { name: string; email: string; passwordHash: string }): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async deleteById(id: number): Promise<User | null> {
    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
    return deleted ?? null;
  }
}
