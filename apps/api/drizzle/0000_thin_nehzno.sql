CREATE TYPE "public"."origin" AS ENUM('domestic', 'foreign');--> statement-breakpoint
CREATE TYPE "public"."unit_of_measure_enum" AS ENUM('g', 'gb');--> statement-breakpoint
CREATE TYPE "public"."gain_reason" AS ENUM('stock_count_gain', 'correction');--> statement-breakpoint
CREATE TYPE "public"."loss_reason" AS ENUM('stock_count_loss', 'damage', 'lost', 'correction');--> statement-breakpoint
CREATE TYPE "public"."retail_buy_status" AS ENUM('DRAFT', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."retail_sell_status" AS ENUM('DRAFT', 'CONFIRMED', 'SHIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."whole_sell_status" AS ENUM('DRAFT', 'CONFIRMED', 'SHIPPED', 'SETTLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."whole_buy_status" AS ENUM('DRAFT', 'CONFIRMED', 'RECEIVED', 'SETTLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."received_status" AS ENUM('RECEIVED', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "bar_sizes" (
	"id" varchar(3) PRIMARY KEY NOT NULL,
	"weight" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"branch_code" varchar(3) PRIMARY KEY NOT NULL,
	"branch_name" varchar NOT NULL,
	"branch_short_name" varchar(10) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_brands" (
	"id" varchar(10) PRIMARY KEY NOT NULL,
	"brand" varchar NOT NULL,
	"non_fungible" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_product_type" (
	"id" varchar(10) PRIMARY KEY NOT NULL,
	"product_type" varchar NOT NULL,
	"supplier_tradeable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purities" (
	"id" varchar(4) PRIMARY KEY NOT NULL,
	"label" varchar(10) NOT NULL,
	"percent" numeric(2, 2) NOT NULL,
	"unit_of_measure" "unit_of_measure_enum" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppler_brands" (
	"supplier_id" uuid,
	"brand_id" varchar(10),
	CONSTRAINT "suppler_brands_supplier_id_brand_id_pk" PRIMARY KEY("supplier_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_product_types" (
	"supplier_id" uuid,
	"product_type_id" varchar(10),
	CONSTRAINT "supplier_product_types_supplier_id_product_type_id_pk" PRIMARY KEY("supplier_id","product_type_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_name" varchar(100) NOT NULL,
	"brand_lock" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"factor_value" numeric(4, 2) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"change_by" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_balance" (
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"origin" "origin" NOT NULL,
	"product_type_id" varchar NOT NULL,
	"total_weight_gb" numeric DEFAULT 0 NOT NULL,
	"total_weight_gm" numeric DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_balance_purity_id_brand_id_origin_product_type_id_pk" PRIMARY KEY("purity_id","brand_id","origin","product_type_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_daily_snapshots" (
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"origin" "origin" NOT NULL,
	"product_type_id" varchar NOT NULL,
	"snapshot_date" date NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"total_cost" numeric NOT NULL,
	CONSTRAINT "inventory_daily_snapshots_purity_id_brand_id_origin_product_type_id_snapshot_date_pk" PRIMARY KEY("purity_id","brand_id","origin","product_type_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"origin" "origin" NOT NULL,
	"product_type_id" varchar NOT NULL,
	"reference_type" varchar NOT NULL,
	"reference_id" uuid NOT NULL,
	"weight_gb_delta" numeric NOT NULL,
	"weight_gm_delta" numeric NOT NULL,
	"cost_delta" numeric NOT NULL,
	"notes" text,
	"moved_at" timestamp DEFAULT now() NOT NULL,
	"moved_by" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_switch_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"from_brand_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"from_cost_delta" numeric NOT NULL,
	"to_cost_delta" numeric NOT NULL,
	"notes" text,
	"switched_by" varchar NOT NULL,
	"switched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_gain_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar,
	"origin" "origin" NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"total_cost" numeric NOT NULL,
	"reason" "gain_reason" NOT NULL,
	"notes" text,
	"audited_by" varchar NOT NULL,
	"audited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_loss_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar,
	"origin" "origin" NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"reason" "loss_reason" NOT NULL,
	"notes" text,
	"audited_by" varchar NOT NULL,
	"audited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_buy_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "retail_buy_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_buy_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buy_numb" varchar NOT NULL,
	"branch_code" varchar NOT NULL,
	"cust_code" varchar NOT NULL,
	"empl_code" varchar NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"brand_text" varchar NOT NULL,
	"size_text" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"gold_price_snapshot" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "retail_buy_status" DEFAULT 'DRAFT' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "retail_buy_transactions_buyNumb_unique" UNIQUE("buy_numb")
);
--> statement-breakpoint
CREATE TABLE "retail_sell_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "retail_sell_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_sell_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_numb" varchar NOT NULL,
	"branch_code" varchar NOT NULL,
	"cust_code" varchar NOT NULL,
	"empl_code" varchar NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"brand_text" varchar NOT NULL,
	"size_text" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"gold_price_snapshot" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "retail_sell_status" DEFAULT 'DRAFT' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "retail_sell_transactions_saleNumb_unique" UNIQUE("sale_numb")
);
--> statement-breakpoint
CREATE TABLE "whole_sell_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "whole_sell_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_sell_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "whole_sell_status" DEFAULT 'DRAFT' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_buy_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "whole_buy_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_buy_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "whole_buy_status" DEFAULT 'DRAFT' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "received_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "received_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "received_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_code" varchar NOT NULL,
	"purity_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"total_cost" numeric NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "received_status" DEFAULT 'RECEIVED' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppler_brands" ADD CONSTRAINT "suppler_brands_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppler_brands" ADD CONSTRAINT "suppler_brands_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_types" ADD CONSTRAINT "supplier_product_types_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_types" ADD CONSTRAINT "supplier_product_types_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_daily_snapshots" ADD CONSTRAINT "inventory_daily_snapshots_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_daily_snapshots" ADD CONSTRAINT "inventory_daily_snapshots_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_daily_snapshots" ADD CONSTRAINT "inventory_daily_snapshots_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_from_brand_id_gold_brands_id_fk" FOREIGN KEY ("from_brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_statuses" ADD CONSTRAINT "retail_buy_statuses_transaction_id_retail_buy_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."retail_buy_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_branch_code_branches_branch_code_fk" FOREIGN KEY ("branch_code") REFERENCES "public"."branches"("branch_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_statuses" ADD CONSTRAINT "retail_sell_statuses_transaction_id_retail_sell_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."retail_sell_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_branch_code_branches_branch_code_fk" FOREIGN KEY ("branch_code") REFERENCES "public"."branches"("branch_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_statuses" ADD CONSTRAINT "whole_sell_statuses_transaction_id_whole_sell_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."whole_sell_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_statuses" ADD CONSTRAINT "whole_buy_statuses_transaction_id_whole_buy_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."whole_buy_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_statuses" ADD CONSTRAINT "received_statuses_transaction_id_received_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."received_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;