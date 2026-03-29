-- MDM SaaS - Initial Schema
-- Run this file to initialize the database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ──────────────────────────────────────────────────────────────────

CREATE TYPE tenant_plan AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
CREATE TYPE user_role AS ENUM ('TENANT_ADMIN', 'MANAGER', 'VIEWER');
CREATE TYPE device_status AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'LOST', 'WIPED');
CREATE TYPE command_type AS ENUM (
  'LOCK', 'UNLOCK', 'WIPE', 'REBOOT',
  'INSTALL_APP', 'UNINSTALL_APP',
  'UPDATE_POLICY', 'ENABLE_KIOSK', 'DISABLE_KIOSK', 'LOCATE'
);
CREATE TYPE command_status AS ENUM ('PENDING', 'SENT', 'EXECUTING', 'EXECUTED', 'FAILED');

-- ─── TENANTS ────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(255) NOT NULL,
  slug         VARCHAR(100) NOT NULL UNIQUE,
  plan         tenant_plan NOT NULL DEFAULT 'FREE',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  settings     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);
CREATE INDEX idx_tenants_is_active ON tenants (is_active);

-- ─── USERS ──────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email             VARCHAR(255) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  role              user_role NOT NULL DEFAULT 'VIEWER',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users (tenant_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_is_active ON users (is_active);

-- ─── POLICIES ───────────────────────────────────────────────────────────────

CREATE TABLE policies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  rules       JSONB NOT NULL DEFAULT '{
    "allowedApps": [],
    "blockedApps": [],
    "kioskMode": false,
    "kioskApps": [],
    "passwordRequired": false,
    "locationTracking": false,
    "trackingIntervalMinutes": 5,
    "wifiOnly": false,
    "screenshotBlocked": false,
    "cameraBlocked": false,
    "usbBlocked": false
  }',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policies_tenant_id ON policies (tenant_id);

-- ─── DEVICES ────────────────────────────────────────────────────────────────

CREATE TABLE devices (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  serial_number    VARCHAR(255) NOT NULL,
  imei             VARCHAR(20),
  android_version  VARCHAR(20),
  manufacturer     VARCHAR(100),
  model            VARCHAR(100),
  status           device_status NOT NULL DEFAULT 'PENDING',
  enrollment_date  TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ,
  current_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  policy_id        UUID REFERENCES policies(id) ON DELETE SET NULL,
  is_kiosk_mode    BOOLEAN NOT NULL DEFAULT FALSE,
  kiosk_apps       JSONB NOT NULL DEFAULT '[]',
  os_version       VARCHAR(20),
  battery_level    SMALLINT CHECK (battery_level >= 0 AND battery_level <= 100),
  is_online        BOOLEAN NOT NULL DEFAULT FALSE,
  device_token     VARCHAR(512) UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, serial_number)
);

CREATE INDEX idx_devices_tenant_id ON devices (tenant_id);
CREATE INDEX idx_devices_status ON devices (status);
CREATE INDEX idx_devices_is_online ON devices (is_online);
CREATE INDEX idx_devices_last_seen_at ON devices (last_seen_at);
CREATE INDEX idx_devices_policy_id ON devices (policy_id);

-- ─── APPS ───────────────────────────────────────────────────────────────────

CREATE TABLE apps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  package_name  VARCHAR(255) NOT NULL,
  version       VARCHAR(50) NOT NULL,
  apk_url       TEXT,
  description   TEXT,
  icon_url      TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, package_name)
);

CREATE INDEX idx_apps_tenant_id ON apps (tenant_id);
CREATE INDEX idx_apps_package_name ON apps (package_name);

-- ─── COMMANDS ───────────────────────────────────────────────────────────────

CREATE TABLE commands (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type         command_type NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       command_status NOT NULL DEFAULT 'PENDING',
  created_by   VARCHAR(36) NOT NULL,
  sent_at      TIMESTAMPTZ,
  executed_at  TIMESTAMPTZ,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commands_tenant_id ON commands (tenant_id);
CREATE INDEX idx_commands_device_status ON commands (device_id, status);
CREATE INDEX idx_commands_created_at ON commands (created_at DESC);

-- ─── LOCATIONS ──────────────────────────────────────────────────────────────

CREATE TABLE locations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id         UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  accuracy          REAL,
  altitude          REAL,
  speed             REAL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_geofence_alert BOOLEAN NOT NULL DEFAULT FALSE,
  geofence_zone_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_locations_device_time ON locations (device_id, timestamp DESC);
CREATE INDEX idx_locations_tenant_id ON locations (tenant_id);
CREATE INDEX idx_locations_geofence_alert ON locations (is_geofence_alert) WHERE is_geofence_alert = TRUE;

-- ─── TRIGGERS: updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tenants_updated_at   BEFORE UPDATE ON tenants   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_users_updated_at     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_devices_updated_at   BEFORE UPDATE ON devices   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_policies_updated_at  BEFORE UPDATE ON policies  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_apps_updated_at      BEFORE UPDATE ON apps      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_commands_updated_at  BEFORE UPDATE ON commands  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
