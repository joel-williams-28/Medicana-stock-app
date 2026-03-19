-- Create intelligence_config table for system-wide intelligence settings
-- Primary use: storing the go-live date for the intelligence engine

CREATE TABLE IF NOT EXISTS intelligence_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default go-live date (empty = not configured yet)
INSERT INTO intelligence_config (key, value)
VALUES ('go_live_date', '')
ON CONFLICT (key) DO NOTHING;
