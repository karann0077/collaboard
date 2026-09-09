-- ============================================================
-- 005_actor_model.sql
-- Decouple membership and invite tables from the users FK so
-- that guest actor IDs (ses_...) can be first-class members.
-- ============================================================

-- 1. room_members: rename user_id -> actor_id, drop users FK
DO $$
BEGIN
  -- Rename column only if it still exists as user_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_members' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE room_members RENAME COLUMN user_id TO actor_id;
  END IF;
END $$;

-- Drop FK constraint if present (name may vary, try both common patterns)
ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_user_id_fkey;
ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_pkey;

-- Recreate PK using the renamed column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'room_members' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE room_members ADD PRIMARY KEY (room_id, actor_id);
  END IF;
END $$;

-- 2. room_invites: rename created_by -> created_by_actor_id, drop users FK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_invites' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE room_invites RENAME COLUMN created_by TO created_by_actor_id;
  END IF;
END $$;

ALTER TABLE room_invites DROP CONSTRAINT IF EXISTS room_invites_created_by_fkey;

-- 3. Index for actor lookups
CREATE INDEX IF NOT EXISTS idx_room_members_actor ON room_members (actor_id);
CREATE INDEX IF NOT EXISTS idx_room_invites_creator ON room_invites (created_by_actor_id);
