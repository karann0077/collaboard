const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

/**
 * Creates a new room in Postgres.
 * Wraps room + sequence creation in a transaction — both rows must exist or neither.
 *
 * @returns {string} the new roomId
 */
async function createRoom() {
  const roomId = nanoid(8);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO rooms (room_id) VALUES ($1)',
      [roomId]
    );
    // Initialize the per-room sequence counter atomically with the room
    await client.query(
      'INSERT INTO room_sequences (room_id, next_seq) VALUES ($1, 1)',
      [roomId]
    );
    await client.query('COMMIT');
    return roomId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Checks if a room exists in Postgres.
 * Used on socket join to validate room codes before any drawing state is sent.
 *
 * @param {string} roomId
 * @returns {boolean}
 */
async function roomExists(roomId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM rooms WHERE room_id = $1',
    [roomId]
  );
  return rows.length > 0;
}

/**
 * Updates last_active timestamp on any room activity.
 * Used by the GC cron to determine which rooms are stale.
 *
 * @param {string} roomId
 */
async function touchRoom(roomId) {
  await pool.query(
    'UPDATE rooms SET last_active = NOW() WHERE room_id = $1',
    [roomId]
  );
}

module.exports = { createRoom, roomExists, touchRoom };
