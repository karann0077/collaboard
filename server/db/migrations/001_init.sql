-- ============================================================
-- rooms: lightweight metadata table
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  room_id       VARCHAR(8)   PRIMARY KEY,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_active   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- draw_events: append-only event log (event sourcing)
--
-- Design decisions:
--   1. BIGSERIAL id         → global monotonic order (debugging/audit)
--   2. seq_num              → per-room monotonic counter; replay can
--                             start from any checkpoint
--   3. event_type CHECK     → domain constraint at DB level, not just app
--   4. payload JSONB        → flexible schema for evolving event shapes
--   5. undone BOOLEAN       → soft-delete for undo (never physically delete
--                             events — that destroys redo capability)
--   6. undone_at            → timestamp for audit/debugging
--   7. ON DELETE CASCADE    → room deletion cascades to events automatically
--   8. (room_id, seq_num)   → covers replay query (range scan in room)
--   9. (room_id, undone, seq_num DESC) → covers undo query
--                             "last non-undone event in this room"
-- ============================================================
CREATE TABLE IF NOT EXISTS draw_events (
  id            BIGSERIAL    PRIMARY KEY,
  room_id       VARCHAR(8)   NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  event_type    VARCHAR(10)  NOT NULL
                             CHECK (event_type IN ('stroke','shape','clear')),
  payload       JSONB        NOT NULL,
  seq_num       BIGINT       NOT NULL,
  undone        BOOLEAN      NOT NULL DEFAULT FALSE,
  undone_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary replay index: WHERE room_id = $1 ORDER BY seq_num ASC
CREATE INDEX IF NOT EXISTS idx_draw_events_room_seq
  ON draw_events (room_id, seq_num ASC);

-- Undo query index: find last non-undone event fast
-- WHERE room_id = $1 AND undone = FALSE ORDER BY seq_num DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_draw_events_undo
  ON draw_events (room_id, undone, seq_num DESC);

-- GIN index: future querying by payload fields (e.g. find all red strokes)
CREATE INDEX IF NOT EXISTS idx_draw_events_payload
  ON draw_events USING GIN (payload);

-- ============================================================
-- room_sequences: per-room atomic sequence counter
--
-- Why not SELECT MAX(seq_num) + 1?
--   Two concurrent inserts both read the same MAX → same seq_num → ordering broken.
--   UPDATE ... RETURNING uses row-level lock — serializes the counter atomically.
-- ============================================================
CREATE TABLE IF NOT EXISTS room_sequences (
  room_id   VARCHAR(8) PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
  next_seq  BIGINT     NOT NULL DEFAULT 1
);

-- Atomic: get-and-increment in one statement (no separate SELECT needed)
CREATE OR REPLACE FUNCTION next_seq_for_room(p_room_id VARCHAR(8))
RETURNS BIGINT AS $$
DECLARE v_seq BIGINT;
BEGIN
  UPDATE room_sequences
  SET next_seq = next_seq + 1
  WHERE room_id = p_room_id
  RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;
