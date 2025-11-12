# 🚨 URGENT: Database Migration Required

## Problem

Your Neon database `transactions` table schema doesn't match what the backend code expects. This will cause **runtime errors** when:
- Viewing the Activity Log
- Performing batch removals
- Fulfilling orders
- Any stock adjustments

## Current vs Expected Schema

### Your Current Schema (WRONG)
```
id, batch_id, location_id, quantity, type, created_at, notes, user_id
```

### Expected Schema (CORRECT)
```
id, batch_id, location_id, medication_id, delta, occurred_at, reason, user_id
```

## Missing Columns
1. ❌ `medication_id` - Required by backend to link transactions to medications
2. ❌ `delta` - Backend expects positive/negative numbers (not `quantity` + `type`)
3. ❌ `occurred_at` - Backend expects this timestamp (not `created_at`)
4. ❌ `reason` - Backend expects this field (not `notes`)

## How to Fix

### Option 1: Run the Migration in Neon Dashboard (RECOMMENDED)

1. **Back up your transactions table first:**
   ```sql
   CREATE TABLE transactions_backup AS SELECT * FROM transactions;
   ```

2. **Run the migration:**
   - Open your Neon dashboard
   - Go to SQL Editor
   - Copy and paste the contents of `database/migrate_transactions_table.sql`
   - Execute the migration
   - Wait for confirmation

3. **Verify the migration:**
   ```sql
   -- Check new columns exist and have data
   SELECT id, medication_id, delta, reason, occurred_at
   FROM transactions
   ORDER BY occurred_at DESC
   LIMIT 10;

   -- Verify no NULL values in required columns
   SELECT COUNT(*) FROM transactions WHERE medication_id IS NULL; -- Should be 0
   SELECT COUNT(*) FROM transactions WHERE delta IS NULL; -- Should be 0
   ```

### Option 2: Use Neon CLI (if you have it installed)

```bash
neon sql-execute --file database/migrate_transactions_table.sql
```

## What the Migration Does

1. ✅ Adds new required columns: `medication_id`, `delta`, `reason`, `occurred_at`
2. ✅ Migrates existing data:
   - Derives `medication_id` from `batch_id` (joins with batches table)
   - Converts `quantity` + `type` to `delta` (positive for 'in', negative for 'out')
   - Copies `notes` to `reason`
   - Copies `created_at` to `occurred_at`
3. ✅ Creates performance indexes
4. ✅ Keeps old columns for safety (can drop them later once verified)

## After Migration

Once the migration is complete:

1. ✅ Activity Log will work correctly
2. ✅ Batch removal tracking will work
3. ✅ Order fulfillment tracking will work
4. ✅ All stock adjustments will be properly recorded

## Safety Notes

- The migration is **non-destructive** - old columns are kept
- A backup is created at the start (if you run the backup command)
- You can roll back by restoring from the backup if needed

## Timeline

**Run this migration ASAP** - the Activity Log features won't work properly until this is done.

## Questions?

If you encounter any issues running the migration:
1. Check the Neon logs for error messages
2. Verify you have sufficient permissions
3. Make sure you've backed up the table first
