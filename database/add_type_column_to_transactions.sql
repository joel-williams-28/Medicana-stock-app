-- Add type column to transactions table
-- This column stores the transaction type: 'in', 'out', 'transfer', 'order_fulfilled', etc.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT;

-- Add index for faster queries filtering by type
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- Optional: Add a check constraint to ensure valid types
-- Uncomment if you want to enforce specific type values:
-- ALTER TABLE transactions
-- ADD CONSTRAINT transactions_type_check
-- CHECK (type IN ('in', 'out', 'transfer', 'order_fulfilled', 'adjustment', 'system'));

-- Update existing records with a default type based on delta value
-- Positive delta = 'in', Negative delta = 'out'
UPDATE transactions
SET type = CASE
  WHEN delta > 0 THEN 'in'
  WHEN delta < 0 THEN 'out'
  ELSE 'adjustment'
END
WHERE type IS NULL;

-- Optional: Make type NOT NULL after backfilling (uncomment if desired)
-- ALTER TABLE transactions ALTER COLUMN type SET NOT NULL;
