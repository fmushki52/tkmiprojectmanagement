ALTER TABLE "attachments" ADD COLUMN "uploaded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "attachments_task_idx" ON "attachments" USING btree ("task_id");