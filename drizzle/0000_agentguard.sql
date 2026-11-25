CREATE TABLE requests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'BLOCK', 'REQUIRE_APPROVAL')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY', 'BLOCKED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  transition_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX requests_owner_created ON requests (owner_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id),
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_owner_created ON audit_events (owner_id, created_at DESC);
