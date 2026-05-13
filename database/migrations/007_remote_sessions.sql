CREATE TABLE IF NOT EXISTS remote_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "deviceId" UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  "initiatedBy" VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt" TIMESTAMPTZ,
  "endedAt" TIMESTAMPTZ
);

CREATE INDEX idx_remote_sessions_tenant_device ON remote_sessions("tenantId", "deviceId", status);
