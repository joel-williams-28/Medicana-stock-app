# Complete Verification Checklist

Run these queries in your Neon SQL Editor to verify everything is correctly set up.

---

## ✅ STEP 1: Verify Transactions Table Schema

### Check Current Schema

```sql
-- See all columns in your transactions table
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
ORDER BY ordinal_position;
```

### Expected Result:

You should see these columns (order doesn't matter):
- ✅ `id` (integer, not nullable)
- ✅ `medication_id` (text, not nullable)
- ✅ `batch_id` (integer, not nullable)
- ✅ `location_id` (text, not nullable)
- ✅ `delta` (integer, not nullable)
- ✅ `reason` (text, nullable or not nullable)
- ✅ `occurred_at` (timestamp with time zone, not nullable)
- ✅ `user_id` (integer, nullable)

### ❌ If you see these OLD columns instead:
- `quantity` instead of `delta`
- `type` instead of (included in `delta` as positive/negative)
- `notes` instead of `reason`
- `created_at` instead of `occurred_at`

**Then you MUST run the migration** (see STEP 3 below)

---

## ✅ STEP 2: Check If You Have Any Transactions Data

```sql
-- Count total transactions
SELECT COUNT(*) as total_transactions FROM transactions;

-- View sample transactions (if any exist)
SELECT * FROM transactions ORDER BY id DESC LIMIT 5;
```

### If you have 0 transactions:
- ✅ Good news! You can skip the migration
- ✅ Just need to fix the schema (easier - see STEP 4)

### If you have existing transactions:
- ⚠️ You MUST run the full migration to preserve data
- ⚠️ Follow STEP 3 carefully

---

## ✅ STEP 3: Run Migration (If You Have Existing Data)

### 3a. Create Backup First (CRITICAL!)

```sql
CREATE TABLE transactions_backup AS SELECT * FROM transactions;

-- Verify backup
SELECT COUNT(*) FROM transactions_backup;
```

### 3b. Check for Data Issues

```sql
-- Check for orphaned transactions (should return 0 rows)
SELECT t.id, t.batch_id, t.location_id
FROM transactions t
LEFT JOIN batches b ON t.batch_id = b.id
WHERE b.id IS NULL;
```

**If you see any rows:** These transactions have invalid batch_ids. You need to:
- Delete them: `DELETE FROM transactions WHERE id IN (<list of ids>);`
- OR fix the batch_id values manually

### 3c. Run the Full Migration

Copy and paste this entire block:

```sql
-- ============================================
-- TRANSACTIONS TABLE MIGRATION
-- ============================================

BEGIN;

-- Add new required columns
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS medication_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS delta INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP WITH TIME ZONE;

-- Derive medication_id from batch_id
UPDATE transactions t
SET medication_id = b.medication_id
FROM batches b
WHERE t.batch_id = b.id
AND t.medication_id IS NULL;

-- Convert quantity + type to delta
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
SET occurred_at = COALESCE(created_at, NOW())
WHERE occurred_at IS NULL;

-- Verify all required data exists
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM transactions WHERE medication_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Found % transactions with NULL medication_id', null_count;
  END IF;
END $$;

-- Make columns NOT NULL
ALTER TABLE transactions ALTER COLUMN medication_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN delta SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN reason SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN reason SET DEFAULT '';
ALTER TABLE transactions ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN occurred_at SET DEFAULT NOW();

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_transactions_medication_id ON transactions(medication_id);
CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_location_id ON transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_transactions_batch_id ON transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

COMMIT;
```

### 3d. Verify Migration Succeeded

```sql
-- All these should return 0
SELECT COUNT(*) FROM transactions WHERE medication_id IS NULL;
SELECT COUNT(*) FROM transactions WHERE delta IS NULL;
SELECT COUNT(*) FROM transactions WHERE occurred_at IS NULL;

-- View migrated data
SELECT id, medication_id, delta, reason, occurred_at
FROM transactions
ORDER BY occurred_at DESC
LIMIT 10;
```

---

## ✅ STEP 4: Quick Fix (If NO Existing Data)

If you have **zero transactions**, you can just fix the schema without migration:

```sql
BEGIN;

-- Drop the entire table and recreate with correct schema
DROP TABLE IF EXISTS transactions CASCADE;

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  medication_id TEXT NOT NULL,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  user_id INTEGER REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_transactions_medication_id ON transactions(medication_id);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX idx_transactions_location_id ON transactions(location_id);
CREATE INDEX idx_transactions_batch_id ON transactions(batch_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);

COMMIT;
```

---

## ✅ STEP 5: Verify Frontend Changes

The frontend changes should already be in place after you pulled from GitHub. Verify them:

### Check in Browser DevTools:

1. Open your app
2. Open Developer Console (F12)
3. Go to Activity Log tab
4. Check for these:

**✅ Quantity Display:**
- Should show "+50" or "-20" (just text, no icon duplication)
- NOT: [+] +50 or [−] -20

**✅ Batch Removed Badge:**
- Any batch removal should show a red badge with "BATCH REMOVED" text
- Badge should be prominent and easy to spot

**✅ Shadow Styling:**
- The Activity Log filter section should have a subtle shadow
- Should match the header and tab navigation styling

**✅ Order Fulfilled Filter:**
- "Orders Fulfilled" filter button should exist
- When clicked, should show only fulfilled orders

---

## ✅ STEP 6: Test Complete Flow

### 6a. Create a Test Transaction

Do a simple stock adjustment in your app:
1. Go to Medications tab
2. Select any medication
3. Add stock (e.g., +10 items)
4. Go to Activity Log tab
5. Verify you see the transaction with "+10" (not [+] +10)

### 6b. Check in Database

```sql
-- See the transaction you just created
SELECT
  id,
  medication_id,
  batch_id,
  location_id,
  delta,
  reason,
  occurred_at
FROM transactions
ORDER BY occurred_at DESC
LIMIT 1;
```

**Verify:**
- ✅ `delta` is positive (e.g., 10)
- ✅ `medication_id` is populated
- ✅ `reason` has a description
- ✅ `occurred_at` is recent

### 6c. Test Batch Removal (if applicable)

1. Remove a batch in your app
2. Go to Activity Log
3. Verify you see the red "BATCH REMOVED" badge
4. Click "Batch Removals" filter
5. Verify the removal is shown

```sql
-- Check batch removal transaction
SELECT
  id,
  medication_id,
  delta,
  reason,
  occurred_at
FROM transactions
WHERE reason LIKE 'Batch removed%'
ORDER BY occurred_at DESC
LIMIT 5;
```

**Verify:**
- ✅ `delta` is negative (stock removed)
- ✅ `reason` starts with "Batch removed"

---

## ✅ STEP 7: Final Cleanup (Optional - Do This Later)

**ONLY after everything works for several days**, remove old columns:

```sql
BEGIN;

ALTER TABLE transactions DROP COLUMN IF EXISTS quantity;
ALTER TABLE transactions DROP COLUMN IF EXISTS type;
ALTER TABLE transactions DROP COLUMN IF EXISTS notes;
ALTER TABLE transactions DROP COLUMN IF EXISTS created_at;

COMMIT;
```

---

## 🚨 Troubleshooting

### Error: "column 'medication_id' does not exist"

**Problem:** Backend is trying to use new schema but database still has old schema

**Solution:** Run the migration (STEP 3) or quick fix (STEP 4)

### Error: "column 'delta' does not exist"

**Problem:** Same as above

**Solution:** Run the migration (STEP 3) or quick fix (STEP 4)

### Activity Log shows no transactions

**Possible causes:**
1. Database query is failing silently - check browser console for errors
2. Transactions table is empty - check with `SELECT COUNT(*) FROM transactions`
3. Schema mismatch causing backend to fail - run STEP 1 verification

### Batch Removed badge not showing

**Verify:**
```sql
-- Check if your batch removals have the correct reason format
SELECT id, reason
FROM transactions
WHERE delta < 0
AND reason LIKE '%batch%' OR reason LIKE '%Batch%' OR reason LIKE '%remov%'
LIMIT 10;
```

The reason must start with **exactly** "Batch removed" (capital B, lowercase r)

---

## Summary Checklist

Use this quick checklist:

- [ ] STEP 1: Verified transactions table schema
- [ ] STEP 2: Checked if existing data exists
- [ ] STEP 3 or 4: Ran migration OR quick fix
- [ ] STEP 5: Verified frontend changes work
- [ ] STEP 6: Tested complete flow
- [ ] Everything working correctly

Once all boxes are checked, you're done! ✅
