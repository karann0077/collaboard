const pool = require('../db/postgres');
const { createRedisClients } = require('../db/redis');
const { projectEvents } = require('@collaboard/shared');

const SNAPSHOT_INTERVAL = Number(process.env.SNAPSHOT_INTERVAL) || 50;
let pubClient = null;

async function getRedis() {
  if (!pubClient) {
    const clients = await createRedisClients();
    pubClient = clients.pubClient;
  }
  return pubClient;
}

async function getLatestSnapshotSeq(roomId) {
  const { rows } = await pool.query('SELECT seq FROM snapshots WHERE room_id = $1 ORDER BY seq DESC LIMIT 1', [roomId]);
  return rows.length ? Number(rows[0].seq) : 0;
}

async function getLatestSnapshot(roomId) {
  const { rows } = await pool.query('SELECT seq, document FROM snapshots WHERE room_id = $1 ORDER BY seq DESC LIMIT 1', [roomId]);
  return rows.length ? { seq: Number(rows[0].seq), document: rows[0].document } : null;
}

async function triggerSnapshotCheck(roomId, currentSeq) {
  const latestSnapshotSeq = await getLatestSnapshotSeq(roomId);
  const eligibleTarget = Math.floor(currentSeq / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
  
  if (eligibleTarget > latestSnapshotSeq && eligibleTarget <= currentSeq) {
    createSnapshot(roomId, eligibleTarget).catch(err => console.error('[Snapshot error]', err.message));
  }
}

async function createSnapshot(roomId, targetSeq) {
  const client = await getRedis();
  const token = Math.random().toString(36).substring(2);
  const lockKey = `snapshot:lock:${roomId}:${targetSeq}`;
  
  const acquired = await client.set(lockKey, token, { NX: true, EX: 60 });
  if (!acquired) return; // Another server is generating this snapshot

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const { rows } = await dbClient.query('SELECT * FROM events WHERE room_id = $1 AND seq <= $2 ORDER BY seq ASC', [roomId, targetSeq]);
    await dbClient.query('COMMIT');

    const normalize = (row) => ({ eventId: row.event_id, roomId: row.room_id, seq: Number(row.seq), eventType: row.event_type, actorId: row.actor_id, payload: row.payload, targetEventId: row.target_event_id, createdAt: row.created_at });
    const document = projectEvents(rows.map(normalize));

    await pool.query(
      `INSERT INTO snapshots (room_id, seq, document) VALUES ($1, $2, $3) ON CONFLICT (room_id, seq) DO NOTHING`,
      [roomId, targetSeq, document]
    );
    console.log(`[Snapshot] Generated snapshot for room ${roomId} at seq ${targetSeq}`);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
    const current = await client.get(lockKey);
    if (current === token) {
      await client.del(lockKey);
    }
  }
}

module.exports = { getLatestSnapshot, getLatestSnapshotSeq, triggerSnapshotCheck };
