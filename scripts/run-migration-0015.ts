import postgres from 'postgres';

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('No DATABASE_URL');
  const sql = postgres(dbUrl, { prepare: false });

  // First ensure the triage tables exist (they may not if drizzle-kit push failed partway)
  const tableCheck = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'triage_rules')`;
  if (!tableCheck[0].exists) {
    console.log('triage_rules table does not exist — creating tables first...');

    // Check and create inbox_items if needed
    const inboxCheck = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inbox_items')`;
    if (!inboxCheck[0].exists) {
      await sql`CREATE TABLE "inbox_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "connector" "connector_type" NOT NULL,
        "external_id" text,
        "sender" text NOT NULL,
        "sender_name" text,
        "sender_avatar" text,
        "subject" text NOT NULL,
        "content" text NOT NULL,
        "preview" text,
        "raw_payload" jsonb,
        "status" "inbox_status" DEFAULT 'new' NOT NULL,
        "snoozed_until" timestamp with time zone,
        "priority" "priority" DEFAULT 'normal' NOT NULL,
        "tags" text[] DEFAULT '{}' NOT NULL,
        "enrichment" jsonb,
        "classification" jsonb,
        "received_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS "inbox_items_status_idx" ON "inbox_items" USING btree ("status")`;
      await sql`CREATE INDEX IF NOT EXISTS "inbox_items_connector_idx" ON "inbox_items" USING btree ("connector")`;
      await sql`CREATE INDEX IF NOT EXISTS "inbox_items_priority_idx" ON "inbox_items" USING btree ("priority")`;
      await sql`CREATE INDEX IF NOT EXISTS "inbox_items_received_at_idx" ON "inbox_items" USING btree ("received_at")`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS "inbox_items_connector_external_id_idx" ON "inbox_items" ("connector", "external_id") WHERE external_id IS NOT NULL`;
      console.log('Created inbox_items table');
    }

    // Create triage_rules with all columns including the new order column
    await sql`CREATE TABLE "triage_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "type" "rule_type" NOT NULL,
      "trigger" jsonb,
      "action" jsonb,
      "guidance" text,
      "status" "rule_status" DEFAULT 'active' NOT NULL,
      "source" "rule_source" NOT NULL,
      "order" integer DEFAULT 0,
      "version" integer DEFAULT 1 NOT NULL,
      "created_by" text DEFAULT 'user' NOT NULL,
      "match_count" integer DEFAULT 0 NOT NULL,
      "last_matched_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS "triage_rules_status_idx" ON "triage_rules" USING btree ("status")`;
    console.log('Created triage_rules table (with order column)');

    // Create ai_cost_log if needed
    const costLogCheck = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ai_cost_log')`;
    if (!costLogCheck[0].exists) {
      await sql`CREATE TABLE "ai_cost_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "provider" text NOT NULL,
        "operation" text NOT NULL,
        "item_id" uuid,
        "input_tokens" integer,
        "output_tokens" integer,
        "estimated_cost" numeric(10, 6),
        "result" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )`;
      await sql`ALTER TABLE "ai_cost_log" ADD CONSTRAINT "ai_cost_log_item_id_inbox_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inbox_items"("id") ON DELETE set null ON UPDATE no action`;
      console.log('Created ai_cost_log table');
    }
  } else {
    // Table exists — just add the order column if it's not there
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'triage_rules' AND column_name = 'order'`;
    if (cols.length > 0) {
      console.log('Column "order" already exists, skipping ADD COLUMN');
    } else {
      await sql`ALTER TABLE triage_rules ADD COLUMN "order" integer DEFAULT 0`;
      console.log('Added "order" column');
    }

    // Backfill existing rules with sequential order based on creation date
    await sql`UPDATE triage_rules SET "order" = subq.row_num FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as row_num FROM triage_rules) subq WHERE triage_rules.id = subq.id`;
    console.log('Backfilled order values');
  }

  // Verify
  const result = await sql`SELECT id, name, "order" FROM triage_rules ORDER BY "order" LIMIT 5`;
  console.log('Rules in table:', result.length);
  if (result.length > 0) {
    console.log('Sample:', JSON.stringify(result, null, 2));
  }

  await sql.end();
  console.log('Migration 0015 complete');
}

run().catch(e => { console.error(e); process.exit(1); });
