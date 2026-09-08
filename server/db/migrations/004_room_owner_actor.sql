-- Support both registered users and guest-session actors as room owners.
-- Guest actor IDs (ses_...) intentionally do not exist in users.user_id.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS owner_actor_id TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_owner_actor
  ON rooms (owner_actor_id);

-- Backfill owners for rooms created before this migration.
UPDATE rooms r
SET owner_actor_id = rm.user_id
FROM room_members rm
WHERE rm.room_id = r.room_id
  AND rm.role = 'owner'
  AND r.owner_actor_id IS NULL;
