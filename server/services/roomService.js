const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

async function createRoom(actorId) {
  const roomId = nanoid(8);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO rooms (room_id, owner_actor_id) VALUES ($1, $2)',
      [roomId, actorId || null]
    );
    await client.query(
      'INSERT INTO room_sequences (room_id, next_seq) VALUES ($1, 1)',
      [roomId]
    );

    if (actorId && !actorId.startsWith('ses_')) {
      await client.query(
        'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
        [roomId, actorId, 'owner']
      );
    }

    await client.query('COMMIT');
    return roomId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function roomExists(roomId) {
  const { rows } = await pool.query('SELECT 1 FROM rooms WHERE room_id = $1', [roomId]);
  return rows.length > 0;
}

async function touchRoom(roomId) {
  await pool.query('UPDATE rooms SET last_active = NOW() WHERE room_id = $1', [roomId]);
}

module.exports = { createRoom, roomExists, touchRoom };
