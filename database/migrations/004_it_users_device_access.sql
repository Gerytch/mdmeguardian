-- Migration 004: IT admin users can access devices
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_access_devices BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS device_username    VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS device_pin_hash    VARCHAR(255) NULL;

-- device_username must be unique per tenant when set
CREATE UNIQUE INDEX IF NOT EXISTS users_device_username_tenant_idx
  ON users ("tenantId", device_username)
  WHERE device_username IS NOT NULL;
