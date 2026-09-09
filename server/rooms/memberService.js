const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

/**
 * Returns the role for the given actor in the given room.
 * Checks both room_members (actor_id column, no user FK) and
 * the rooms.owner_actor_id field so guests can be owners.
 * Returns null if the actor has no explicit membership.
 */
async function getMemberRole(roomId, actorId) {
  const { rows } = await pool.query(
    `SELECT role
       FROM room_members
      WHERE room_id = $1 AND actor_id = $2
     UNION ALL
     SELECT 'owner' AS role
       FROM rooms
      WHERE room_id = $1 AND owner_actor_id = $2
      LIMIT 1`,
    [roomId, actorId]
  );
  return rows.length ? rows[0].role : null;
}

/**
 * Adds or updates a member in the room.
 * Accepts any actor ID — guest (ses_...) or registered user (usr_...).
 */
async function addMember(roomId, actorId, role) {
  await pool.query(
    `INSERT INTO room_members (room_id, actor_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, actor_id) DO UPDATE SET role = EXCLUDED.role`,
    [roomId, actorId, role]
  );
}

/**
 * Creates an invite code for a room.
 * created_by_actor_id accepts any actor type.
 */
async function createInvite(roomId, createdByActorId, role, expiresInHours = 24) {
  const VALID_ROLES = ['editor', 'viewer'];
  if (!VALID_ROLES.includes(role)) {
    const err = new Error(`Invalid role: must be 'editor' or 'viewer'`);
    err.statusCode = 400;
    throw err;
  }

  const inviteCode = `inv_${nanoid(16)}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000);
  await pool.query(
    `INSERT INTO room_invites (invite_code, room_id, created_by_actor_id, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [inviteCode, roomId, createdByActorId, role, expiresAt]
  );
  return inviteCode;
}

/**
 * Redeems an invite code for the given actor.
 * actor_id accepts any actor type (guest or user).
 */
async function redeemInvite(inviteCode, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT room_id, role, expires_at FROM room_invites WHERE invite_code = $1 FOR UPDATE',
      [inviteCode]
    );
    if (rows.length === 0) throw new Error('Invalid invite code');
    if (new Date() > new Date(rows[0].expires_at)) throw new Error('Invite expired');

    await client.query(
      `INSERT INTO room_members (room_id, actor_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, actor_id) DO NOTHING`,
      [rows[0].room_id, actorId, rows[0].role]
    );
    await client.query('COMMIT');
    return rows[0].room_id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getMemberRole, addMember, createInvite, redeemInvite };
