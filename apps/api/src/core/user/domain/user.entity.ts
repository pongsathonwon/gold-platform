import type { UserRole } from "../../../infrastructure/db/schema/user.schema.js";

export type User = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  /** Deactivation tombstone; null means the account can sign in. */
  deletedAt: Date | null;
};

/** An account that has not been deactivated. The only kind that may authenticate. */
export const isActive = (user: User): boolean => user.deletedAt === null;

/**
 * What a user record looks like once it leaves the server.
 *
 * Defined by picking fields rather than by omitting `passwordHash`, so a column added to `User`
 * later is invisible here until someone deliberately adds it. The `/users` list previously
 * returned whole rows and shipped every hash to the caller.
 *
 * `deletedAt` is surfaced as a boolean rather than as the timestamp. The administration page needs
 * to know whether an account is live, and when it was switched off is not a question anyone has
 * asked — a date would just be an extra column to render and explain.
 */
export type PublicUser = Pick<User, "id" | "name" | "username" | "role"> & {
  active: boolean;
};

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  username: user.username,
  role: user.role,
  active: isActive(user),
});
