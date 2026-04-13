-- Migration 003: device admin user flag
ALTER TABLE device_users
  ADD COLUMN IF NOT EXISTS is_device_admin BOOLEAN NOT NULL DEFAULT FALSE;
