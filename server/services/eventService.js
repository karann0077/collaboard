const pool = require('../db/postgres');
const { AppError } = require('../utils/errors');
const { normalize } = require('../collaboration/projectionService');
const { isDeepStrictEqual } = require('util');

async function appendEvent(roomId, eventType, payload, actorId, eventId, targetEventId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [eventId]);
    const existing = await client.query('SELECT * FROM events WHERE event_id=$1', [eventId]);
    
    if (existing.rows[0]) {
      const event = existing.rows[0];
      if (
        event.room_id !== roomId || 
        event.actor_id !== actorId || 
        event.event_type !== eventType || 
        !isDeepStrictEqual(event.payload, payload) || 
        event.target_event_id !== targetEventId
      ) {
        throw new AppError('EVENT_ID_REUSE', 'eventId was already committed with different data', 409);
      }
      await client.query('COMMIT');
      return normalize(event);
    }
    
    const seq = (await client.query('SELECT next_seq_for_room($1) AS seq', [roomId])).rows[0].seq;
    const { rows } = await client.query(
      'INSERT INTO events(event_id,room_id,seq,event_type,actor_id,payload,target_event_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [eventId, roomId, seq, eventType, actorId, JSON.stringify(payload), targetEventId]
    );
    await client.query('COMMIT');
    return normalize(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { appendEvent };
