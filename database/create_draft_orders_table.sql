-- create_draft_orders_table.sql
-- Phase 1: Smart Draft Orders for Pharmacist Approval Flow
-- Draft orders are auto-generated proposals based on intelligence recommendations.
-- Once approved, they create real orders in the existing orders table.

CREATE TABLE IF NOT EXISTS draft_orders (
    id SERIAL PRIMARY KEY,

    -- What medication needs ordering
    medication_id BIGINT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    location_id BIGINT,

    -- Snapshot of stock state at generation time
    current_stock_boxes NUMERIC(10,2) NOT NULL DEFAULT 0,
    min_level_boxes INTEGER NOT NULL DEFAULT 0,
    suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity > 0),
    approved_quantity INTEGER,  -- NULL until approved; pharmacist can adjust

    -- Urgency (auto-calculated with trend boost, pharmacist can override)
    urgency VARCHAR(20) NOT NULL DEFAULT 'routine'
        CHECK (urgency IN ('urgent', 'routine', 'non-urgent')),

    -- Intelligence data snapshot at generation time
    intelligence_snapshot JSONB,

    -- Source tracking
    source VARCHAR(20) NOT NULL DEFAULT 'auto'
        CHECK (source IN ('auto', 'manual')),

    -- Lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected')),

    -- Who did what
    generated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

    -- Timestamps
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,

    -- Link to the real order created on approval
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,

    -- Batch tracking (groups all drafts from one generation run)
    batch_ref UUID NOT NULL,

    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_draft_orders_status ON draft_orders(status);
CREATE INDEX IF NOT EXISTS idx_draft_orders_medication_id ON draft_orders(medication_id);
CREATE INDEX IF NOT EXISTS idx_draft_orders_batch_ref ON draft_orders(batch_ref);
CREATE INDEX IF NOT EXISTS idx_draft_orders_generated_at ON draft_orders(generated_at DESC);
