-- Create or replace the inventory_full view
-- This view denormalizes inventory data for efficient querying

CREATE OR REPLACE VIEW inventory_full AS
SELECT
  -- Batch and inventory identifiers
  b.id AS batch_id,
  i.location_id,
  l.display_name AS location_name,
  l.group_name AS location_group,

  -- Medication identifiers and details
  m.id AS medication_id,
  m.name AS medication_name,
  CASE
    WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
    ELSE m.name || ' ' || m.strength
  END AS medication_display_id,
  m.barcode,

  -- Batch details
  b.batch_code,
  b.brand,
  b.expiry_date,

  -- Inventory quantities
  i.on_hand,
  b.items_per_box,
  CASE
    WHEN b.items_per_box IS NOT NULL AND b.items_per_box > 0
    THEN FLOOR(i.on_hand::DECIMAL / b.items_per_box::DECIMAL)
    ELSE NULL
  END AS number_of_boxes,

  -- Medication metadata
  m.form AS type,
  m.strength AS strength_raw,
  CASE
    WHEN m.strength IS NULL OR m.strength = 'N/A' THEN ''
    ELSE m.strength
  END AS strength_clean,
  m.min_level_boxes,
  CASE
    WHEN b.items_per_box IS NOT NULL AND b.items_per_box > 0
    THEN m.min_level_boxes * b.items_per_box
    ELSE NULL
  END AS min_level_items

FROM inventory i
INNER JOIN batches b ON i.batch_id = b.id
INNER JOIN medications m ON b.medication_id = m.id
INNER JOIN locations l ON i.location_id = l.id
WHERE m.is_active = true;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_inventory_location_batch ON inventory(location_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_on_hand ON inventory(on_hand);
CREATE INDEX IF NOT EXISTS idx_batches_medication ON batches(medication_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);
