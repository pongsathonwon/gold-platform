-- Baseline schema. This is a squash of the 19 migrations (0000–0018) that built the schema before
-- the first deployment, generated fresh from `src/infrastructure/db/schema/` and verified to
-- reproduce the old chain exactly: 230 columns, 71 constraints, 28 indexes and the label ordering
-- of all 11 enum types compared identical against a database built the long way.
--
-- Two things differ from the chain, both unobservable: physical column order (a column added by a
-- later ALTER sat at the end of its table; here every column is in declaration order), and the
-- internal `enumsortorder` floats that `ALTER TYPE ... ADD VALUE ... BEFORE` leaves behind. Drizzle
-- names columns explicitly and nothing orders by an enum, so neither reaches the application.
--
-- The prose from the squashed migrations — why a column was backfilled before being constrained,
-- which legacy status mapped to which — is kept in `docs/schema-history.md`. The files themselves
-- are in git history before the squash commit.
--
-- Regenerating: always `pnpm exec drizzle-kit generate`, never ad-hoc `--schema/--out` flags. Those
-- bypass `drizzle.config.ts` and silently drop `casing: 'snake_case'`, producing a baseline with
-- camelCase column names that applies cleanly and then breaks every query at runtime.

CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'OPERATOR');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('domestic', 'foreign');--> statement-breakpoint
CREATE TYPE "public"."unit_of_measure_enum" AS ENUM('g', 'gb');--> statement-breakpoint
CREATE TYPE "public"."weight_input_unit" AS ENUM('kg', 'gb');--> statement-breakpoint
CREATE TYPE "public"."retail_buy_status" AS ENUM('DRAFT', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."retail_sell_status" AS ENUM('DRAFT', 'CONFIRMED', 'SHIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."whole_sell_return_reason" AS ENUM('WEIGHT', 'BRAND', 'PURITY', 'DAMAGED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."whole_sell_status" AS ENUM('CREATED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'PAID', 'DISPUTED', 'PAYMENT_FAILED', 'CANCELLED', 'REJECTED', 'RETURNED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."whole_buy_return_reason" AS ENUM('WEIGHT', 'BRAND', 'PURITY', 'DAMAGED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."whole_buy_status" AS ENUM('CREATED', 'CONFIRMED', 'PAID', 'RECEIVED', 'STOCKED', 'PAYMENT_FAILED', 'DELIVERY_FAILED', 'DISPUTED', 'CANCELLED', 'REJECTED', 'RETURNED', 'REFUNDED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."received_status" AS ENUM('RECEIVED', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'OPERATOR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
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
	"active" boolean DEFAULT true NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gold_brands" (
	"id" varchar(10) PRIMARY KEY NOT NULL,
	"brand" varchar NOT NULL,
	"non_fungible" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_type_purities" (
	"product_type_id" varchar(10) NOT NULL,
	"purity_id" varchar(4) NOT NULL,
	"input_unit" "weight_input_unit" NOT NULL,
	"min_quantity" integer NOT NULL,
	"allowed_values" integer[],
	"step_quantity" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_type_purities_product_type_id_purity_id_pk" PRIMARY KEY("product_type_id","purity_id")
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
	"percent" numeric(5, 2) NOT NULL,
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
	"factor_value" numeric(6, 4) NOT NULL,
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
	"movement_date" date NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_by" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_switch_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"from_brand_id" varchar NOT NULL,
	"to_brand_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"from_cost_delta" numeric NOT NULL,
	"to_cost_delta" numeric NOT NULL,
	"notes" text,
	"switched_by" varchar NOT NULL,
	"switched_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"price_per_gb" numeric NOT NULL,
	"total_cost" numeric NOT NULL,
	"reference_type" varchar NOT NULL,
	"notes" text,
	"transaction_date" date NOT NULL,
	"audited_by" varchar NOT NULL,
	"audited_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"reference_type" varchar NOT NULL,
	"notes" text,
	"transaction_date" date NOT NULL,
	"audited_by" varchar NOT NULL,
	"audited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_buy_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "retail_buy_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_buy_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_code" varchar NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"brand_id" varchar,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"operation_fee" numeric,
	"transaction_date" date NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "retail_buy_status" DEFAULT 'CONFIRMED' NOT NULL,
	"source" varchar DEFAULT 'MANUAL' NOT NULL,
	"notes" text,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_sell_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "retail_sell_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_sell_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_code" varchar NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"brand_id" varchar,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"operation_fee" numeric,
	"transaction_date" date NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "retail_sell_status" DEFAULT 'CONFIRMED' NOT NULL,
	"source" varchar DEFAULT 'MANUAL' NOT NULL,
	"notes" text,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_sell_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "whole_sell_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_sell_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"price_per_gb_999" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"actual_weight_gb" numeric,
	"actual_weight_gm" numeric,
	"actual_amount" numeric,
	"settled_amount" numeric,
	"return_reason" "whole_sell_return_reason",
	"transaction_date" date NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "whole_sell_status" DEFAULT 'CREATED' NOT NULL,
	"confirm_due_at" timestamp with time zone NOT NULL,
	"notes" text,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_buy_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "whole_buy_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whole_buy_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purity_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"weight_gb" numeric NOT NULL,
	"weight_gm" numeric NOT NULL,
	"conversion_factor" numeric NOT NULL,
	"price_per_gb" numeric NOT NULL,
	"price_per_gb_999" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"actual_weight_gb" numeric,
	"actual_weight_gm" numeric,
	"actual_amount" numeric,
	"settled_amount" numeric,
	"return_reason" "whole_buy_return_reason",
	"transaction_date" date NOT NULL,
	"settlement_period" varchar NOT NULL,
	"current_status" "whole_buy_status" DEFAULT 'CREATED' NOT NULL,
	"confirm_due_at" timestamp with time zone NOT NULL,
	"notes" text,
	"recorded_by" varchar NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "received_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "received_status" NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_type_purities" ADD CONSTRAINT "product_type_purities_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_purities" ADD CONSTRAINT "product_type_purities_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppler_brands" ADD CONSTRAINT "suppler_brands_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppler_brands" ADD CONSTRAINT "suppler_brands_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_types" ADD CONSTRAINT "supplier_product_types_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_types" ADD CONSTRAINT "supplier_product_types_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_from_brand_id_gold_brands_id_fk" FOREIGN KEY ("from_brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_switch_adjustments" ADD CONSTRAINT "product_switch_adjustments_to_brand_id_gold_brands_id_fk" FOREIGN KEY ("to_brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_gain_adjustments" ADD CONSTRAINT "stock_gain_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_loss_adjustments" ADD CONSTRAINT "stock_loss_adjustments_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_statuses" ADD CONSTRAINT "retail_buy_statuses_transaction_id_retail_buy_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."retail_buy_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_branch_code_branches_branch_code_fk" FOREIGN KEY ("branch_code") REFERENCES "public"."branches"("branch_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_buy_transactions" ADD CONSTRAINT "retail_buy_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_statuses" ADD CONSTRAINT "retail_sell_statuses_transaction_id_retail_sell_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."retail_sell_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_branch_code_branches_branch_code_fk" FOREIGN KEY ("branch_code") REFERENCES "public"."branches"("branch_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sell_transactions" ADD CONSTRAINT "retail_sell_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_statuses" ADD CONSTRAINT "whole_sell_statuses_transaction_id_whole_sell_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."whole_sell_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_sell_transactions" ADD CONSTRAINT "whole_sell_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_statuses" ADD CONSTRAINT "whole_buy_statuses_transaction_id_whole_buy_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."whole_buy_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whole_buy_transactions" ADD CONSTRAINT "whole_buy_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_statuses" ADD CONSTRAINT "received_statuses_transaction_id_received_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."received_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_brand_id_gold_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."gold_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_transactions" ADD CONSTRAINT "received_transactions_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_movement_date_idx" ON "inventory_movements" USING btree ("movement_date","moved_at","id");