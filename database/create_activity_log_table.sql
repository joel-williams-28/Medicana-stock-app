-- Activity Log table for comprehensive audit trail
-- Stores all user actions: logins, stock movements, medication changes, orders, etc.

CREATE TABLE IF NOT EXISTS activity_log (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  action_type   TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  location_id   TEXT,
  details       JSONB DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_activity_log_occurred_at ON activity_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action_type ON activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

-- Action types:
-- login, stock_in, stock_out, stock_transfer, batch_added, batch_removed,
-- medication_created, medication_deleted, min_level_changed, order_placed, order_fulfilled
