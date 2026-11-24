ALTER TABLE "rh"."colaboradores" ADD COLUMN "pin_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."colaboradores" ADD COLUMN "pin_definido_em" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."colaboradores" ADD CONSTRAINT "colab_pin_formato" CHECK (pin_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$');