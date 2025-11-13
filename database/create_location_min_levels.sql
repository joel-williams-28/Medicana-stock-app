-- Create table for per-location minimum stock levels
-- This allows each location to have different minimum stock levels for the same medication

CREATE TABLE IF NOT EXISTS location_min_levels (
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  min_level_boxes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, medication_id)
);

-- Migrate existing min_level_boxes from medications table to location_min_levels
-- Copy the same minimum level to all locations for each medication
INSERT INTO location_min_levels (location_id, medication_id, min_level_boxes)
SELECT l.id, m.id, COALESCE(m.min_level_boxes, 0)
FROM medications m
CROSS JOIN locations l
WHERE m.is_active = true
ON CONFLICT (location_id, medication_id) DO NOTHING;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_location_min_levels_medication ON location_min_levels(medication_id);
CREATE INDEX IF NOT EXISTS idx_location_min_levels_location ON location_min_levels(location_id);

-- Add comment
COMMENT ON TABLE location_min_levels IS 'Stores minimum stock levels per location for each medication';
