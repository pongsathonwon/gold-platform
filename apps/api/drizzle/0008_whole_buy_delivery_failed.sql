-- wholesale-buy gains the failure path its mirror already had: PAID → RECEIVED was previously
-- the only exit from PAID, so a supplier who took our money and never shipped stranded the
-- transaction there forever with no terminal.
--
--   PAID            → RECEIVED | DELIVERY_FAILED
--   DELIVERY_FAILED → RECEIVED | WRITTEN_OFF
--
-- This is the exact counterpart of the sell side's DELIVERED → PAYMENT_FAILED → WRITTEN_OFF:
-- in both domains it covers "the counterparty took the valuable thing and never handed over its
-- other half". Neither has a route to CANCELLED — ours already moved.
--
-- Pure additions to the enum, so ALTER TYPE ADD VALUE is used rather than the drop-and-recreate
-- dance in 0006/0007: no existing row changes value and no column has to round-trip through text.
-- Safe inside a transaction on PostgreSQL 12+ because the new labels are not read in this
-- migration. IF NOT EXISTS keeps it idempotent.
ALTER TYPE "public"."whole_buy_status" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED' AFTER 'PAYMENT_FAILED';--> statement-breakpoint
ALTER TYPE "public"."whole_buy_status" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';
