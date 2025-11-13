-- SQL Diagnostic Script for Stock Transfer Issues
-- Run this in your Neon console to check database integrity

-- 1. Check if locations table has proper data
SELECT 'LOCATIONS TABLE' as check_type;
SELECT id, display_name, group_name
FROM locations
ORDER BY display_name
LIMIT 10;

-- 2. Check if inventory table uses correct location_id format
SELECT 'INVENTORY SAMPLE' as check_type;
SELECT i.location_id, l.display_name, i.batch_id, i.on_hand, b.batch_code
FROM inventory i
LEFT JOIN locations l ON l.id = i.location_id
LEFT JOIN batches b ON b.id = i.batch_id
LIMIT 10;

-- 3. Find any inventory rows with invalid location_id (not matching locations table)
SELECT 'ORPHANED INVENTORY RECORDS' as check_type;
SELECT i.location_id, COUNT(*) as count
FROM inventory i
LEFT JOIN locations l ON l.id = i.location_id
WHERE l.id IS NULL
GROUP BY i.location_id;

-- 4. Check for medications with batches but no inventory entries
SELECT 'BATCHES WITHOUT INVENTORY' as check_type;
SELECT b.id as batch_id, b.batch_code, m.name as medication_name, b.brand, b.expiry_date
FROM batches b
JOIN medications m ON m.id = b.medication_id
WHERE NOT EXISTS (
    SELECT 1 FROM inventory i WHERE i.batch_id = b.id
)
LIMIT 10;

-- 5. Check transactions table structure
SELECT 'RECENT TRANSACTIONS' as check_type;
SELECT id, occurred_at, location_id, batch_id, medication_id, delta, type, reason
FROM transactions
ORDER BY occurred_at DESC
LIMIT 5;

-- 6. Check if there are any foreign key constraints missing on transactions
SELECT 'TRANSACTIONS TABLE CONSTRAINTS' as check_type;
SELECT conname, contype, confdeltype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'transactions'::regclass;

-- 7. Check inventory table constraints
SELECT 'INVENTORY TABLE CONSTRAINTS' as check_type;
SELECT conname, contype, confdeltype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'inventory'::regclass;
