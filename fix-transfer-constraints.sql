-- SQL Script to Fix Stock Transfer Database Constraints
-- This adds missing foreign key constraints and ensures data integrity

-- 1. Add foreign key constraint from inventory.location_id to locations.id (if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_location_id_fkey'
    ) THEN
        ALTER TABLE inventory
        ADD CONSTRAINT inventory_location_id_fkey
        FOREIGN KEY (location_id)
        REFERENCES locations(id)
        ON DELETE CASCADE;

        RAISE NOTICE 'Added foreign key constraint: inventory_location_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists: inventory_location_id_fkey';
    END IF;
END $$;

-- 2. Add foreign key constraint from transactions.location_id to locations.id (if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'transactions_location_id_fkey'
    ) THEN
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_location_id_fkey
        FOREIGN KEY (location_id)
        REFERENCES locations(id);

        RAISE NOTICE 'Added foreign key constraint: transactions_location_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists: transactions_location_id_fkey';
    END IF;
END $$;

-- 3. Create indexes for better performance (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_inventory_location_id ON inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batch_id ON inventory(batch_id);

-- 4. Verify constraints were added
SELECT 'VERIFICATION: Inventory Constraints' as check_type;
SELECT conname, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'inventory'::regclass;

SELECT 'VERIFICATION: Transactions Constraints' as check_type;
SELECT conname, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'transactions'::regclass
AND conname LIKE '%location%';
