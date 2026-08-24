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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UserRole = (typeof userRoleEnum.enumValues)[number];
