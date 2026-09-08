const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

async function getMemberRole(roomId, actorId) {
  const { rows } = await pool.query(
    `SELECT role
       FROM room_members
      WHERE room_id = $1 AND user_id = $2
     UNION ALL
     SELECT 'owner' AS role
       FROM rooms
      WHERE room_id = $1 AND owner_actor_id = $2
      LIMIT 1`,
    [roomId, actorId]
  );
  return rows.length ? rows[0].role : null;
}

async function addMember(roomId, userId, role) {
  await pool.query(
    'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role',
    [roomId, userId, role]
  );
}

async function createInvite(roomId, createdBy, role, expiresInHours = 24) {
  const inviteCode = `inv_${nanoid(16)}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000);
  await pool.query(
    'INSERT INTO room_invites (invite_code, room_id, created_by, role, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [inviteCode, roomId, createdBy, role, expiresAt]
  );
  return inviteCode;
}

async function redeemInvite(inviteCode, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT room_id, role, expires_at FROM room_invites WHERE invite_code = $1 FOR UPDATE', [inviteCode]);
    if (rows.length === 0) throw new Error('Invalid invite code');
    if (new Date() > new Date(rows[0].expires_at)) throw new Error('Invite expired');

    await client.query(
      'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING',
      [rows[0].room_id, userId, rows[0].role]
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
