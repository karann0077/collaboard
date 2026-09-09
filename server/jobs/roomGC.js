const cron = require('node-cron');
const pool = require('../db/postgres');
const { createRedisClients } = require('../db/redis');
const { nanoid } = require('nanoid');

const STALE_AFTER_DAYS = process.env.ROOM_TTL_DAYS || '7';

/**
 * Checks whether any active Socket.IO presence entries exist for a room.
 * Uses the Redis sorted-set written by presenceService.
 * If any connection has a score (expiry timestamp) in the future, the room is active.
 */
async function hasActivePresence(redis, roomId) {
  const now = Date.now();
  // zRangeByScore with score > now means unexpired presence entries
  const active = await redis.zRangeByScore(`presence:${roomId}`, (now + 1).toString(), '+inf');
  return active.length > 0;
}

async function startRoomGC() {
  const { pubClient: redis } = await createRedisClients();

  cron.schedule('0 2 * * *', async () => {
    console.log(`[GC] Attempting room cleanup (TTL: ${STALE_AFTER_DAYS} days)...`);

    // Redis distributed lock — only one server instance runs GC at a time
    const token = nanoid();
    const acquired = await redis.set('gc:lock', token, { NX: true, EX: 3600 });
    if (!acquired) {
      console.log('[GC] Lock acquired by another instance. Skipping.');
      return;
    }

    try {
      // Find candidate stale rooms (last_active expired) — but do NOT delete yet
      const { rows: candidates } = await pool.query(
        `SELECT room_id FROM rooms
         WHERE last_active < NOW() - INTERVAL '${STALE_AFTER_DAYS} days'`
      );

      if (candidates.length === 0) {
        console.log('[GC] No stale rooms found.');
        return;
      }

      // Filter out rooms with active participants (Bug #15 fix)
      const toDelete = [];
      for (const { room_id } of candidates) {
        const active = await hasActivePresence(redis, room_id);
        if (active) {
          console.log(`[GC] Skipping room ${room_id} — has active participants.`);
        } else {
          toDelete.push(room_id);
        }
      }

      if (toDelete.length === 0) {
        console.log('[GC] All stale rooms are currently active — skipping deletion.');
        return;
      }

      const { rowCount } = await pool.query(
        `DELETE FROM rooms WHERE room_id = ANY($1::text[]) RETURNING room_id`,
        [toDelete]
      );
      console.log(`[GC] Deleted ${rowCount} stale room(s): ${toDelete.join(', ')}`);
    } catch (err) {
      console.error('[GC] Room cleanup failed:', err.message);
    } finally {
      const current = await redis.get('gc:lock');
      if (current === token) {
        await redis.del('gc:lock');
      }
    }
  });

  console.log(`[GC] Room GC scheduled — daily at 02:00 AM (TTL: ${STALE_AFTER_DAYS} days)`);
}

module.exports = { startRoomGC };
