-- Create location_min_levels table for per-location minimum stock levels
-- Each location can have its own minimum stock level for each medication,
-- overriding the global medications.min_level_boxes value.

CREATE TABLE IF NOT EXISTS location_min_levels (
  medication_id  TEXT NOT NULL,
  location_id    TEXT NOT NULL,
  min_level_boxes INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_by     TEXT,
  PRIMARY KEY (medication_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_lml_med ON location_min_levels(medication_id);
CREATE INDEX IF NOT EXISTS idx_lml_loc ON location_min_levels(location_id);

-- Seed from existing global min_level_boxes values
-- This ensures every current medication+location pair starts with the same
-- min level it already has, making the migration transparent.
INSERT INTO location_min_levels (medication_id, location_id, min_level_boxes)
SELECT DISTINCT m.id, i.location_id, m.min_level_boxes
FROM medications m
JOIN batches b ON b.medication_id = m.id
JOIN inventory i ON i.batch_id = b.id
WHERE m.is_active = true AND m.min_level_boxes > 0
ON CONFLICT DO NOTHING;
