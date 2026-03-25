-- Migration: Create 3 admin users
-- Password for all accounts: medicana01!
-- Bcrypt hash (10 rounds): $2b$10$WSjQivv6wv/knlYa.tIWnO8X6EHeJdC9Pap/IAawp5y5pmd2wSNAO

INSERT INTO users (username, password_hash, email, first_name, full_name, role, active)
VALUES
  ('admin1', '$2b$10$WSjQivv6wv/knlYa.tIWnO8X6EHeJdC9Pap/IAawp5y5pmd2wSNAO', 'admin1@medicana.co.uk', 'Admin', 'Admin One', 'Administrator', true),
  ('admin2', '$2b$10$WSjQivv6wv/knlYa.tIWnO8X6EHeJdC9Pap/IAawp5y5pmd2wSNAO', 'admin2@medicana.co.uk', 'Admin', 'Admin Two', 'Administrator', true),
  ('admin3', '$2b$10$WSjQivv6wv/knlYa.tIWnO8X6EHeJdC9Pap/IAawp5y5pmd2wSNAO', 'admin3@medicana.co.uk', 'Admin', 'Admin Three', 'Administrator', true)
ON CONFLICT (username) DO NOTHING;
