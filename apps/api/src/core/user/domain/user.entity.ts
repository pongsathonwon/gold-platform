import type { UserRole } from "../../../infrastructure/db/schema/user.schema.js";

export type User = {
  id: number;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
};

/**
 * What a user record looks like once it leaves the server.
 *
 * Defined by picking fields rather than by omitting `passwordHash`, so a column added to `User`
 * later is invisible here until someone deliberately adds it. The `/users` list previously
 * returned whole rows and shipped every hash to the caller.
 */
export type PublicUser = Pick<User, "id" | "name" | "username" | "role">;

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  username: user.username,
  role: user.role,
});
