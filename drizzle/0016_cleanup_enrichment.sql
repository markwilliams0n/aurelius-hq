-- Phase 8: Consolidate enrichment data
-- Move classification.enrichment data into enrichment column where it's missing,
-- then strip enrichment from classification JSONB to remove the overlap.

-- Step 1: Merge classification.enrichment into the enrichment column
UPDATE inbox_items
SET enrichment = COALESCE(enrichment, '{}'::jsonb) || (classification->'enrichment')
WHERE classification->'enrichment' IS NOT NULL;

-- Step 2: Remove the enrichment key from classification JSONB
UPDATE inbox_items
SET classification = classification - 'enrichment'
WHERE classification ? 'enrichment';
