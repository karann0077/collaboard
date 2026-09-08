-- ============================================================
-- Step 1: Backfill active draw_events → events
-- ============================================================
INSERT INTO events (event_id, room_id, seq, event_type, actor_id, payload, created_at)
SELECT
    'evt_migr_' || id::text,
    room_id,
    seq_num,
    CASE event_type
        WHEN 'stroke' THEN 'stroke.created'
        WHEN 'shape'  THEN 'shape.created'
        WHEN 'clear'  THEN 'board.cleared'
    END,
    NULL,
    payload,
    created_at
FROM draw_events
WHERE undone = FALSE
ORDER BY seq_num ASC
ON CONFLICT (event_id) DO NOTHING;

-- ============================================================
-- Step 2: Convert undone=TRUE rows to explicit event.undone events
-- ============================================================
-- First insert all undone source events:
INSERT INTO events (event_id, room_id, seq, event_type, actor_id, payload, created_at)
SELECT
    'evt_migr_' || id::text,
    room_id,
    seq_num,
    CASE event_type
        WHEN 'stroke' THEN 'stroke.created'
        WHEN 'shape'  THEN 'shape.created'
        WHEN 'clear'  THEN 'board.cleared'
    END,
    NULL,
    payload,
    created_at
FROM draw_events
WHERE undone = TRUE
ORDER BY seq_num ASC
ON CONFLICT (event_id) DO NOTHING;

-- Note: The allocation of new sequences for the event.undone rows 
-- should ideally be done through a Node.js script using next_seq_for_room()
-- to ensure atomicity. We provide a pure SQL fallback below.
-- Note: This is an unsafe sequence bump if the app is live. Maintenance mode required.
DO $$
DECLARE
    r RECORD;
    new_seq BIGINT;
BEGIN
    FOR r IN SELECT id, room_id FROM draw_events WHERE undone = TRUE ORDER BY id ASC LOOP
        UPDATE room_sequences SET next_seq = next_seq + 1 WHERE room_id = r.room_id RETURNING next_seq INTO new_seq;
        INSERT INTO events (event_id, room_id, seq, event_type, actor_id, payload, target_event_id, created_at)
        VALUES (
            'evt_undo_migr_' || r.id, 
            r.room_id, 
            new_seq - 1, 
            'event.undone', 
            NULL,
            jsonb_build_object('targetEventId', 'evt_migr_' || r.id),
            'evt_migr_' || r.id,
            NOW()
        )
        ON CONFLICT (event_id) DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================
-- Step 3: Rename old tables (DO NOT DROP)
-- ============================================================
ALTER TABLE draw_events RENAME TO draw_events_archived;

-- ============================================================
-- Step 4: Validation queries (run after migration, before cutover)
-- ============================================================
-- Check: no seq gaps per room
-- SELECT room_id, COUNT(*) as event_count, MAX(seq) as max_seq
-- FROM events GROUP BY room_id HAVING COUNT(*) != MAX(seq);

-- Check: all target_event_ids reference existing events
-- SELECT e.event_id FROM events e WHERE e.event_type IN ('event.undone', 'event.redone')
--   AND NOT EXISTS (SELECT 1 FROM events t WHERE t.event_id = e.target_event_id);

-- ============================================================
-- Rollback strategy
-- ============================================================
-- If rollback is needed:
--   DROP TABLE IF EXISTS events;
--   ALTER TABLE draw_events_archived RENAME TO draw_events;
