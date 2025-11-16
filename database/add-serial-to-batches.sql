-- Migration: Add serial number field to batches table for GS1 DataMatrix support
-- Date: 2025-11-16
-- Purpose: Store serial numbers (AI 21) from GS1 2D medicine pack barcodes

-- Add serial column to batches table (nullable, as not all batches will have serials)
ALTER TABLE batches
ADD COLUMN IF NOT EXISTS serial text;

-- Add comment to document the field
COMMENT ON COLUMN batches.serial IS 'Serial number from GS1 DataMatrix barcode (AI 21). Used for package-level traceability and regulatory compliance. Nullable as not all batches have serial numbers.';

-- Create index for faster serial number lookups (useful for recall scenarios)
CREATE INDEX IF NOT EXISTS idx_batches_serial ON batches(serial) WHERE serial IS NOT NULL;

-- Verification query - check the updated schema
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'batches'
  AND table_schema = 'public'
ORDER BY ordinal_position;
