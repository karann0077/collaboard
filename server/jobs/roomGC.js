const cron = require('node-cron');
const pool = require('../db/postgres');

// TTL is configurable via env — no hardcoded magic numbers in code
const STALE_AFTER_DAYS = process.env.ROOM_TTL_DAYS || '7';

/**
 * Starts the room GC cron job.
 *
 * Schedule: daily at 2:00 AM
 *   - 2 AM is a low-traffic window — GC runs DELETE which acquires locks
 *   - Configurable if needed (change cron expression)
 *
 * What it does:
 *   Deletes rooms where last_active < NOW() - INTERVAL '$N days'.
 *   ON DELETE CASCADE in the schema automatically removes:
 *     - draw_events (all events for the room)
 *     - room_sequences (the per-room counter)
 *   No manual child-table cleanup needed.
 *
 * Error handling:
 *   GC errors are logged but do NOT crash the server.
 *   GC failure is recoverable — data accumulates but no data is lost.
 *   Contrast with a request handler where failure = user-facing error.
 */
function startRoomGC() {
  cron.schedule('0 2 * * *', async () => {
    console.log(`[GC] Starting room cleanup (TTL: ${STALE_AFTER_DAYS} days)...`);
    try {
      const { rows, rowCount } = await pool.query(
        // RETURNING lets us log what was deleted without a separate COUNT query
        `DELETE FROM rooms
         WHERE last_active < NOW() - INTERVAL '${STALE_AFTER_DAYS} days'
         RETURNING room_id`
      );

      if (rowCount > 0) {
        console.log(
          `[GC] Deleted ${rowCount} stale room(s): ${rows.map(r => r.room_id).join(', ')}`
        );
      } else {
        console.log('[GC] No stale rooms found.');
      }
    } catch (err) {
      // Log and continue — GC failure is not fatal
      console.error('[GC] Room cleanup failed:', err.message);
    }
  });

  console.log(`[GC] Room GC scheduled — daily at 02:00 AM (TTL: ${STALE_AFTER_DAYS} days)`);
}

module.exports = { startRoomGC };
