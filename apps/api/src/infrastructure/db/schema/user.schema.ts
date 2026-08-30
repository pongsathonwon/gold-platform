import { pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * What a login is allowed to do.
 *
 * Two roles, because two is what the operations actually distinguish today. `OPERATOR` runs the
 * trading day: create and advance wholesale transactions, read inventory. `ADMIN` additionally
 * holds the powers that either rewrite the books or hand out access — the manual inventory
 * adjustments (whose tables carry an `auditedBy` column precisely because someone is accountable
 * for them) and user creation.
 *
 * Deliberately not a permission matrix. A role table with granular grants is the right shape once
 * the business has said which jobs exist; inventing that split here would be guessing at an
 * org chart. Adding a third role later is a column value, not a redesign.
 */
export const userRoleEnum = pgEnum('user_role', ['ADMIN', 'OPERATOR'])

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Least privilege by default: a row created without an explicit role cannot adjust stock or
  // create further logins. Escalating is a deliberate act, never an omission.
  role: userRoleEnum("role").notNull().default('OPERATOR'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Deactivation tombstone; null means the account can sign in.
   *
   * A login is never hard-deleted. `recordedBy`, `movedBy`, `auditedBy` and `createdBy` across
   * every domain store a *username string* rather than a foreign key, so removing the row does not
   * break those records — but it does destroy the only place the person behind the name is
   * described, and it frees the username to be issued to somebody else. From then on two different
   * people share one name in the audit trail with nothing to separate them.
   *
   * So the `unique` on `username` is deliberately left covering deactivated rows: a departed
   * operator's username stays reserved, permanently. That is the point rather than a side effect.
   *
   * `branches` established this pattern and pairs `deletedAt` with a separate reversible `active`
   * flag. Users get only the tombstone: "not trading right now" is a meaningful state for a branch
   * and nothing anyone has asked for on an account, and restoring is what covers a mistaken one.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type UserRole = (typeof userRoleEnum.enumValues)[number];
