const cron = require('node-cron');
const pool = require('../db/postgres');
const { createRedisClients } = require('../db/redis');
const { nanoid } = require('nanoid');

const STALE_AFTER_DAYS = process.env.ROOM_TTL_DAYS || '7';

async function startRoomGC() {
  const { pubClient: redis } = await createRedisClients();
  
  cron.schedule('0 2 * * *', async () => {
    console.log(`[GC] Attempting to start room cleanup (TTL: ${STALE_AFTER_DAYS} days)...`);
    
    // Redis distributed lock
    const token = nanoid();
    const acquired = await redis.set('gc:lock', token, { NX: true, EX: 3600 });
    if (!acquired) {
      console.log('[GC] Lock acquired by another instance. Skipping.');
      return;
    }

    try {
      const { rows, rowCount } = await pool.query(
        `DELETE FROM rooms
         WHERE last_active < NOW() - INTERVAL '${STALE_AFTER_DAYS} days'
         RETURNING room_id`
      );

      if (rowCount > 0) {
        console.log(`[GC] Deleted ${rowCount} stale room(s): ${rows.map(r => r.room_id).join(', ')}`);
      } else {
        console.log('[GC] No stale rooms found.');
      }
    } catch (err) {
      console.error('[GC] Room cleanup failed:', err.message);
    } finally {
      // Token-verified release
      const current = await redis.get('gc:lock');
      if (current === token) {
        await redis.del('gc:lock');
      }
    }
  });

  console.log(`[GC] Room GC scheduled — daily at 02:00 AM (TTL: ${STALE_AFTER_DAYS} days)`);
}

module.exports = { startRoomGC };
