-- Migration: Add brand column to medications table
-- Allows storing a default/primary brand per medication for pre-go-live database population

ALTER TABLE medications ADD COLUMN IF NOT EXISTS brand TEXT;
