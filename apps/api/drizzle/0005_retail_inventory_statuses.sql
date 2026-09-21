ALTER TYPE "public"."retail_buy_status" ADD VALUE 'STOCKED' BEFORE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."retail_sell_status" ADD VALUE 'PACKED' BEFORE 'SHIPPED';