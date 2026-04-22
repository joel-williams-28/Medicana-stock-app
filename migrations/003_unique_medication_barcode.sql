-- 003_unique_medication_barcode.sql
-- Enforce barcode uniqueness on medications so barcode-lookup.js and
-- medication-delete.js have a single source of truth. Uses a partial unique
-- index rather than a table constraint because many existing medications
-- legitimately have NULL or empty barcodes.

-- Remove any accidental duplicate barcodes first (keeps the row with the
-- lowest medication id when ids are numeric, otherwise keeps the lexically
-- smallest id). Ignores NULL and empty barcodes.
DELETE FROM medications a
USING medications b
WHERE a.id > b.id
  AND a.barcode = b.barcode
  AND a.barcode IS NOT NULL
  AND a.barcode <> '';

-- Partial unique index: allows many rows with NULL or '' barcode, but
-- forbids any two rows from sharing a non-empty barcode.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_medications_barcode
  ON medications (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';
