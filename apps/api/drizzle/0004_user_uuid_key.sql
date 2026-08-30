-- `users.id` becomes a uuid, like every other key in this schema.
--
-- It was the last `serial`. Nothing referenced it: `recordedBy`, `movedBy`, `auditedBy` and
-- `createdBy` across every domain store a *username string* rather than a foreign key, so there
-- are no constraints to rewrite and no rows anywhere that need remapping. That is precisely why
-- this is worth doing now -- a key type is cheap to change while it is unreferenced and expensive
-- once it is not.
--
-- **Every row gets a new id.** There is no meaning in the old integers to preserve: nothing points
-- at them and nobody quotes them. `gen_random_uuid()` in the USING clause is evaluated per row.
--
-- drizzle-kit generates `ALTER COLUMN "id" SET DATA TYPE uuid` for this, which fails outright --
-- "column id cannot be cast automatically to type uuid" -- and would also leave the serial's
-- `nextval` default and its sequence behind. Hence the hand-written form. The order matters:
-- the old default is integer-typed and has to go before the column type changes under it.
--
-- ## Operational consequence: everyone is signed out once.
--
-- A JWT minted before this carries a *number* in `sub`. Its signature stays valid, so nothing
-- would otherwise reject it, and the failure would be quiet rather than loud: the
-- self-deactivation guard compares the target id against that claim, and a number never equals a
-- uuid string, so an admin could switch off their own account. `authMiddleware` therefore refuses
-- any token whose `sub` is not a string, with `STALE_TOKEN`. Tokens last an hour, so this is a
-- single re-login at deploy and nothing afterwards.

ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
DROP SEQUENCE IF EXISTS "users_id_seq";
