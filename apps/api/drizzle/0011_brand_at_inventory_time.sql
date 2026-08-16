ALTER TABLE "whole_sell_transactions" DROP CONSTRAINT "whole_sell_transactions_brand_id_gold_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" DROP CONSTRAINT "whole_buy_transactions_brand_id_gold_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" DROP COLUMN "brand_id";--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" DROP COLUMN "brand_id";