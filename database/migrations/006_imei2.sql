-- Migration 006: add imei2 column for dual-SIM devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS imei2 VARCHAR(20) NULL;
