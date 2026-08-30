import { Data } from "effect";

export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{ id: string }> {}

/**
 * Refuses to deactivate the account making the request.
 *
 * The token already issued stays valid for the rest of its hour, so the caller would keep working
 * and then be locked out at renewal with no obvious cause. Deactivating a colleague is a decision;
 * deactivating yourself is almost always a misclick on the wrong row.
 */
export class CannotDeactivateSelfError extends Data.TaggedError("CannotDeactivateSelfError")<{
    id: string;
}> {}

/**
 * Refuses to deactivate the only remaining administrator.
 *
 * Creating accounts, restoring them and adjusting inventory are all ADMIN-only, so an installation
 * with no active admin cannot appoint one — recovery is a manual UPDATE against the database. The
 * check is on the *active* count, which is why it belongs behind the same transaction-shaped read
 * as the deactivation itself rather than in the UI.
 */
export class LastAdminError extends Data.TaggedError("LastAdminError")<{ id: string }> {}
