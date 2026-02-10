ALTER TABLE triage_rules ADD COLUMN "order" integer DEFAULT 0;

-- Backfill existing rules with sequential order based on creation date
UPDATE triage_rules SET "order" = subq.row_num FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as row_num FROM triage_rules
) subq WHERE triage_rules.id = subq.id;
