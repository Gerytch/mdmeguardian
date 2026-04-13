-- Migration 002: offline sessions support
-- Adds is_offline flag and offline_session_id for sync idempotency

ALTER TABLE device_sessions
  ADD COLUMN IF NOT EXISTS is_offline BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offline_session_id VARCHAR(36) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_sessions_offline_session_id
  ON device_sessions (offline_session_id)
  WHERE offline_session_id IS NOT NULL;
