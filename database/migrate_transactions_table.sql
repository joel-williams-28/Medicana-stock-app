-- Migration: Update transactions table to match expected schema
-- This migration transforms the old schema to the new schema expected by the backend

-- IMPORTANT: Back up your transactions table before running this migration!
-- Run: CREATE TABLE transactions_backup AS SELECT * FROM transactions;

BEGIN;

-- Step 1: Add new columns with proper defaults
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS medication_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS delta INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP WITH TIME ZONE;

-- Step 2: Migrate data from old columns to new columns
-- Derive medication_id from batch_id (join with batches table)
UPDATE transactions t
SET medication_id = b.medication_id
FROM batches b
WHERE t.batch_id = b.id
AND t.medication_id IS NULL;

-- Convert quantity + type to delta (positive for 'in', negative for 'out')
UPDATE transactions
SET delta = CASE
  WHEN type = 'in' THEN quantity
  WHEN type = 'out' THEN -quantity
  ELSE quantity
END
WHERE delta IS NULL;

-- Copy notes to reason
UPDATE transactions
SET reason = COALESCE(notes, '')
WHERE reason IS NULL;

-- Copy created_at to occurred_at
UPDATE transactions
SET occurred_at = created_at
WHERE occurred_at IS NULL;

-- Step 3: Make required columns NOT NULL (now that they have data)
ALTER TABLE transactions ALTER COLUMN medication_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN delta SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN reason SET DEFAULT '';
ALTER TABLE transactions ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN occurred_at SET DEFAULT NOW();

-- Step 4: Drop old columns (OPTIONAL - keep them for a while for safety)
-- Uncomment these lines when you're confident the migration worked correctly
-- ALTER TABLE transactions DROP COLUMN IF EXISTS quantity;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS type;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS notes;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS created_at;

-- Step 5: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_medication_id ON transactions(medication_id);
CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_location_id ON transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_transactions_batch_id ON transactions(batch_id);

COMMIT;

-- Verify the migration
-- Run these queries to check the data looks correct:
-- SELECT id, medication_id, delta, reason, occurred_at FROM transactions ORDER BY occurred_at DESC LIMIT 10;
-- SELECT COUNT(*) FROM transactions WHERE medication_id IS NULL; -- Should be 0
-- SELECT COUNT(*) FROM transactions WHERE delta IS NULL; -- Should be 0
