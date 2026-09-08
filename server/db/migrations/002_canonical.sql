-- Canonical, append-only collaboration log. Do not remove draw_events here.
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  room_id VARCHAR(8) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL,
  target_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, seq),
  CHECK ((event_type IN ('event.undone', 'event.redone') AND target_event_id IS NOT NULL)
      OR (event_type NOT IN ('event.undone', 'event.redone') AND target_event_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_events_room_actor_seq ON events(room_id, actor_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_events_target ON events(room_id, target_event_id, seq DESC) WHERE target_event_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS snapshots (
  room_id VARCHAR(8) NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  seq BIGINT NOT NULL, document JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(room_id, seq)
);
CREATE OR REPLACE FUNCTION prevent_events_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'events table is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_events_immutable ON events;
CREATE TRIGGER trg_events_immutable BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION prevent_events_mutation();
