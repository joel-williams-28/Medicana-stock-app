-- Diagnostic queries to check transfer issue

-- 1. Check if the inventory_full view exists
SELECT EXISTS (
  SELECT FROM information_schema.views
  WHERE table_schema = 'public'
  AND table_name = 'inventory_full'
) AS view_exists;

-- 2. Check recent transactions (should show both source and target transfers)
SELECT
  t.id,
  t.occurred_at,
  t.type,
  t.delta,
  l.display_name AS location,
  m.name AS medication,
  t.reason
FROM transactions t
LEFT JOIN locations l ON l.id = t.location_id
LEFT JOIN medications m ON m.id = t.medication_id
ORDER BY t.occurred_at DESC
LIMIT 20;

-- 3. Check inventory table directly (should show stock at target location after transfer)
SELECT
  i.location_id,
  l.display_name AS location_name,
  i.batch_id,
  b.brand,
  b.batch_code,
  m.name AS medication_name,
  i.on_hand
FROM inventory i
INNER JOIN batches b ON i.batch_id = b.id
INNER JOIN medications m ON b.medication_id = m.id
INNER JOIN locations l ON i.location_id = l.id
WHERE i.on_hand > 0
ORDER BY i.location_id, m.name, b.expiry_date;

-- 4. If view exists, check what it returns
SELECT *
FROM inventory_full
WHERE on_hand > 0
ORDER BY location_id, medication_name, expiry_date
LIMIT 50;

-- 5. Check for a specific medication across all locations
-- Replace 'Paracetamol' with the medication you're testing
SELECT
  l.display_name AS location,
  b.brand,
  b.batch_code,
  b.expiry_date,
  i.on_hand,
  m.name
FROM inventory i
INNER JOIN batches b ON i.batch_id = b.id
INNER JOIN medications m ON b.medication_id = m.id
INNER JOIN locations l ON i.location_id = l.id
WHERE m.name LIKE '%Paracetamol%' OR m.name LIKE '%medication_name%'
ORDER BY l.display_name, b.expiry_date;
