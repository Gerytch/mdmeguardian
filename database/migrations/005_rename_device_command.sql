-- Migration 005: add RENAME_DEVICE to command type enum
ALTER TYPE commands_type_enum ADD VALUE IF NOT EXISTS 'RENAME_DEVICE';
