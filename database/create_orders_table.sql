-- ============================================================
-- ORDERS TABLE SCHEMA FOR NEON DATABASE
-- ============================================================
-- This table tracks medication order requests placed through the system
-- Run this SQL in your Neon database console

CREATE TABLE IF NOT EXISTS orders (
    -- Primary key
    id SERIAL PRIMARY KEY,

    -- Foreign keys
    medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

    -- Order details
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    urgency VARCHAR(20) NOT NULL DEFAULT 'routine' CHECK (urgency IN ('urgent', 'routine', 'non-urgent')),
    notes TEXT,
    pharmacist_email VARCHAR(255) NOT NULL,

    -- Order status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
    ordered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMP WITH TIME ZONE,

    -- Tracking
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_medication_id ON orders(medication_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at DESC);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_orders_updated_at();

-- Add a comment to the table
COMMENT ON TABLE orders IS 'Tracks medication order requests with status tracking';
COMMENT ON COLUMN orders.urgency IS 'Priority level: urgent, routine, or non-urgent';
COMMENT ON COLUMN orders.status IS 'Order status: pending, fulfilled, or cancelled';
COMMENT ON COLUMN orders.ordered_at IS 'When the order was placed';
COMMENT ON COLUMN orders.fulfilled_at IS 'When the order was marked as fulfilled';
