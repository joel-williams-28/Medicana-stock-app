-- Add location groups for Theatres and Wards
-- This script updates the locations table to add group_name values

-- Update Theatre locations to be part of "Theatres" group
UPDATE locations
SET group_name = 'Theatres'
WHERE display_name IN ('Theatre 1', 'Theatre 2', 'Theatre 3');

-- Update Ward locations to be part of "Wards" group
UPDATE locations
SET group_name = 'Wards'
WHERE display_name IN ('Ward 1', 'Ward 2', 'Ward 3');

-- Update Cupboard locations to be part of "Medication Stock L1" group
UPDATE locations
SET group_name = 'Medication Stock L1'
WHERE display_name IN ('Cupboard 1', 'Cupboard 2', 'Cupboard 3');

-- Verify the changes
SELECT display_name, group_name
FROM locations
ORDER BY
  CASE WHEN group_name IS NOT NULL THEN 0 ELSE 1 END,
  group_name,
  display_name;
