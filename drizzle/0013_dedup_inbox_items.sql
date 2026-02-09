-- Remove duplicate inbox items, keeping the one with the latest updatedAt per (connector, external_id)
DELETE FROM inbox_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY connector, external_id
        ORDER BY updated_at DESC
      ) AS rn
    FROM inbox_items
    WHERE external_id IS NOT NULL
  ) sub
  WHERE rn > 1
);
--> statement-breakpoint
-- Prevent future duplicates: unique index on (connector, external_id) where external_id is set
CREATE UNIQUE INDEX inbox_items_connector_external_id_idx
  ON inbox_items (connector, external_id)
  WHERE external_id IS NOT NULL;
