CREATE TYPE "public"."weight_input_unit" AS ENUM('kg', 'gb');--> statement-breakpoint
CREATE TABLE "product_type_purities" (
	"product_type_id" varchar(10) NOT NULL,
	"purity_id" varchar(4) NOT NULL,
	"input_unit" "weight_input_unit" NOT NULL,
	"min_quantity" integer NOT NULL,
	"allowed_values" integer[],
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_type_purities_product_type_id_purity_id_pk" PRIMARY KEY("product_type_id","purity_id")
);
--> statement-breakpoint
ALTER TABLE "product_type_purities" ADD CONSTRAINT "product_type_purities_product_type_id_gold_product_type_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."gold_product_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_purities" ADD CONSTRAINT "product_type_purities_purity_id_purities_id_fk" FOREIGN KEY ("purity_id") REFERENCES "public"."purities"("id") ON DELETE no action ON UPDATE no action;