import { users } from "./schema/user.js";

export { users };
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
