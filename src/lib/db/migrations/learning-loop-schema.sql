-- Learning Loop Schema Migration
-- Adds support for proposed/dismissed rules, learned source, and pattern tracking

-- Add new rule_status values for proposed/dismissed workflow
ALTER TYPE rule_status ADD VALUE IF NOT EXISTS 'proposed';
ALTER TYPE rule_status ADD VALUE IF NOT EXISTS 'dismissed';

-- Add new rule_source value for learned rules
ALTER TYPE rule_source ADD VALUE IF NOT EXISTS 'learned';

-- Add columns for pattern tracking and evidence
ALTER TABLE triage_rules ADD COLUMN IF NOT EXISTS pattern_key text;
ALTER TABLE triage_rules ADD COLUMN IF NOT EXISTS evidence jsonb;

-- Add index on pattern_key for dedup lookups
CREATE INDEX IF NOT EXISTS triage_rules_pattern_key_idx ON triage_rules (pattern_key) WHERE pattern_key IS NOT NULL;
