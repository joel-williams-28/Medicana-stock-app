-- Remove "Medication Stock L1" as a physical location
-- It is an umbrella group heading for Cupboards 1, 2, and 3 — not a real location.
--
-- Step 1: Move any inventory from med-stock-l1 to cupboard-1
UPDATE inventory
SET location_id = 'cupboard-1'
WHERE location_id = 'med-stock-l1';

-- Step 2: Move any location_min_levels
UPDATE location_min_levels
SET location_id = 'cupboard-1'
WHERE location_id = 'med-stock-l1'
  AND NOT EXISTS (
    SELECT 1 FROM location_min_levels lml2
    WHERE lml2.medication_id = location_min_levels.medication_id
      AND lml2.location_id = 'cupboard-1'
  );

DELETE FROM location_min_levels
WHERE location_id = 'med-stock-l1';

-- Step 3: Update any transactions referencing this location
UPDATE transactions
SET location_id = 'cupboard-1'
WHERE location_id = 'med-stock-l1';

-- Step 4: Update any activity_log entries
UPDATE activity_log
SET location_id = 'cupboard-1'
WHERE location_id = 'med-stock-l1';

-- Step 5: Update any users assigned to this location
UPDATE users
SET location = 'cupboard-1'
WHERE location = 'med-stock-l1';

-- Step 6: Delete the location
DELETE FROM locations WHERE id = 'med-stock-l1';

-- Verify
SELECT id, display_name, group_name FROM locations ORDER BY group_name, display_name;
