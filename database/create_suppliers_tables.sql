-- Migration: Create supplier integration tables
-- Run against Neon PostgreSQL production database

-- 1. Create suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_number TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  order_method VARCHAR NOT NULL DEFAULT 'email',
  portal_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create medication_suppliers junction table
CREATE TABLE IF NOT EXISTS medication_suppliers (
  medication_id TEXT NOT NULL REFERENCES medications(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_product_code TEXT,
  unit_price NUMERIC,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  lead_time_days INT,
  min_order_quantity INT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (medication_id, supplier_id)
);

-- 3. Create supplier_orders tracking table
CREATE TABLE IF NOT EXISTS supplier_orders (
  id SERIAL PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  batch_ref UUID NOT NULL DEFAULT gen_random_uuid(),
  status VARCHAR NOT NULL DEFAULT 'draft',
  supplier_reference TEXT,
  expected_delivery DATE,
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  sent_by INT REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Extend orders table with supplier columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_order_id INT REFERENCES supplier_orders(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_product_code TEXT;

-- 5. Performance indexes
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_medication_suppliers_med ON medication_suppliers(medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_suppliers_supplier ON medication_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status, supplier_id);

-- 6. Seed initial suppliers
INSERT INTO suppliers (id, name, order_method) VALUES
  ('aah', 'AAH Pharmaceuticals', 'email'),
  ('alliance', 'Alliance Healthcare', 'email')
ON CONFLICT (id) DO NOTHING;
