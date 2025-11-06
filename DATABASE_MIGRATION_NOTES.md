# Database Migration Notes - Min Level to Boxes Conversion

## Required Database Changes

### 1. Rename Column in `medications` Table

If `medications.min_level` still exists, it needs to be renamed to `min_level_boxes`:

```sql
-- Rename the column
ALTER TABLE medications RENAME COLUMN min_level TO min_level_boxes;

-- If the column doesn't exist yet, create it
-- ALTER TABLE medications ADD COLUMN min_level_boxes INTEGER DEFAULT 0;
```

### 2. Update `inventory_full` View

The `inventory_full` view needs to be updated to expose both:
- `min_level_boxes` - the minimum level in boxes (from medications table)
- `min_level_items` - calculated as `min_level_boxes * items_per_box` (for internal calculations)

Example view update (adjust based on your actual view definition):

```sql
CREATE OR REPLACE VIEW inventory_full AS
SELECT 
  -- ... existing columns ...
  m.min_level_boxes,
  CASE 
    WHEN b.items_per_box IS NOT NULL AND b.items_per_box > 0 
    THEN m.min_level_boxes * b.items_per_box 
    ELSE NULL 
  END AS min_level_items,
  -- ... rest of existing columns ...
FROM medications m
-- ... existing joins ...
```

**Note:** The exact SQL will depend on your current `inventory_full` view definition. The key is to:
1. Include `m.min_level_boxes` from the medications table
2. Calculate `min_level_items` as `min_level_boxes * items_per_box` when items_per_box is available

## Backend Changes (Already Completed)

✅ `medication-upsert.js` - Updated to use `min_level_boxes` and store raw box values
✅ `meds-get.js` - Updated to query `min_level_boxes` and include `numberOfBoxes` in response
✅ `meds-add.js` - Updated to use `min_level_boxes` and store raw box values

## Frontend Changes (Already Completed)

✅ `formatMinLevelDisplay` - Now displays boxes directly from `minLevelBoxes`
✅ Low-stock comparisons - Now use `getTotalBoxes(med) < med.minLevelBoxes`
✅ All modals - Updated to label as "Min stock (boxes)" and pass raw box values
✅ Edit Min Level modal - Simplified to only accept boxes
✅ Add Medication modal - Simplified to only accept boxes
✅ Barcode New Medication modal - Simplified to only accept boxes

## Testing Checklist

After applying database changes, verify:

1. ✅ Entering 3 as Min Level for a product with 16 items per box shows 3 boxes in the list, not 48
2. ✅ Neon inventory_full shows `min_level_boxes = 3` and `min_level_items = 48`
3. ✅ Low-stock highlights trigger only when `number_of_boxes < min_level_boxes`
4. ✅ The modal and list consistently show "boxes" everywhere

