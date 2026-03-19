-- One-time migration: backfill activity_log from existing transactions table
-- Run this AFTER creating the activity_log table

-- Step 1: Insert non-transfer transactions
INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, location_id, details, occurred_at)
SELECT
  t.user_id,
  CASE
    WHEN t.reason LIKE 'Batch removed%' THEN 'batch_removed'
    WHEN t.reason LIKE 'Order fulfilled%' THEN 'order_fulfilled'
    WHEN t.delta > 0 THEN 'stock_in'
    ELSE 'stock_out'
  END,
  'medication',
  t.medication_id::text,
  t.location_id::integer,
  jsonb_build_object(
    'medicationName', CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name ELSE m.name || ' ' || m.strength END,
    'batchId', t.batch_id,
    'batchCode', b.batch_code,
    'expiryDate', b.expiry_date,
    'brand', b.brand,
    'delta', t.delta,
    'reason', t.reason,
    'locationName', l.display_name,
    'transactionId', t.id,
    'migratedFromTransactions', true
  ),
  t.occurred_at
FROM transactions t
LEFT JOIN medications m ON m.id = t.medication_id
LEFT JOIN batches b ON b.id = t.batch_id
LEFT JOIN locations l ON l.id = t.location_id
WHERE t.reason NOT LIKE 'Transfer to%'
  AND t.reason NOT LIKE 'Transfer from%';

-- Step 2: Insert transfer transactions as single events (from the 'out' side, enriched with 'in' side target)
INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, location_id, details, occurred_at)
SELECT
  t_out.user_id,
  'stock_transfer',
  'medication',
  t_out.medication_id::text,
  t_out.location_id::integer,
  jsonb_build_object(
    'medicationName', CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name ELSE m.name || ' ' || m.strength END,
    'batchId', t_out.batch_id,
    'batchCode', b.batch_code,
    'delta', ABS(t_out.delta),
    'sourceLocationId', t_out.location_id,
    'sourceLocationName', l_src.display_name,
    'targetLocationId', t_in.location_id,
    'targetLocationName', l_tgt.display_name,
    'reason', t_out.reason,
    'transactionId', t_out.id,
    'migratedFromTransactions', true
  ),
  t_out.occurred_at
FROM transactions t_out
JOIN transactions t_in ON t_in.medication_id = t_out.medication_id
  AND t_in.batch_id = t_out.batch_id
  AND t_in.type = 'in'
  AND t_in.reason LIKE 'Transfer from%'
  AND ABS(EXTRACT(EPOCH FROM (t_in.occurred_at - t_out.occurred_at))) < 5
LEFT JOIN medications m ON m.id = t_out.medication_id
LEFT JOIN batches b ON b.id = t_out.batch_id
LEFT JOIN locations l_src ON l_src.id = t_out.location_id
LEFT JOIN locations l_tgt ON l_tgt.id = t_in.location_id
WHERE t_out.type = 'out' AND t_out.reason LIKE 'Transfer to%';

-- Step 3: Insert any orphaned "Transfer from" entries (no matching "Transfer to" within 5s)
INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, location_id, details, occurred_at)
SELECT
  t.user_id,
  'stock_transfer',
  'medication',
  t.medication_id::text,
  t.location_id::integer,
  jsonb_build_object(
    'medicationName', CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name ELSE m.name || ' ' || m.strength END,
    'batchId', t.batch_id,
    'batchCode', b.batch_code,
    'delta', t.delta,
    'reason', t.reason,
    'locationName', l.display_name,
    'transactionId', t.id,
    'migratedFromTransactions', true
  ),
  t.occurred_at
FROM transactions t
LEFT JOIN medications m ON m.id = t.medication_id
LEFT JOIN batches b ON b.id = t.batch_id
LEFT JOIN locations l ON l.id = t.location_id
WHERE t.reason LIKE 'Transfer from%'
  AND NOT EXISTS (
    SELECT 1 FROM transactions t_out
    WHERE t_out.medication_id = t.medication_id
      AND t_out.batch_id = t.batch_id
      AND t_out.type = 'out'
      AND t_out.reason LIKE 'Transfer to%'
      AND ABS(EXTRACT(EPOCH FROM (t.occurred_at - t_out.occurred_at))) < 5
  );
