const pool = require('../db/postgres');
const { projectEvents, createEmptyDocument } = require('../../packages/shared');
function normalize(row) { return { eventId: row.event_id, roomId: row.room_id, seq: Number(row.seq), eventType: row.event_type, actorId: row.actor_id, payload: row.payload, targetEventId: row.target_event_id, createdAt: row.created_at }; }
async function replayRoom(roomId, upToSeq) { const values = upToSeq === undefined ? [roomId] : [roomId, upToSeq]; const clause = upToSeq === undefined ? '' : ' AND seq <= $2'; const { rows } = await pool.query(`SELECT * FROM events WHERE room_id = $1${clause} ORDER BY seq ASC`, values); return rows.length ? projectEvents(rows.map(normalize)) : createEmptyDocument(); }
async function getRoomVersion(roomId) { const { rows } = await pool.query('SELECT COALESCE(MAX(seq), 0)::bigint AS seq FROM events WHERE room_id = $1', [roomId]); return Number(rows[0].seq); }
module.exports = { replayRoom, getRoomVersion, normalize };
