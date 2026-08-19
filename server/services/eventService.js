const pool = require('../db/postgres');

/**
 * Appends a draw event to the log with an atomic per-room sequence number.
 *
 * Uses a transaction to pair the sequence increment with the insert —
 * if the insert fails, the sequence number is rolled back (no gaps in the log).
 *
 * @param {string} roomId
 * @param {'stroke'|'shape'|'clear'} eventType
 * @param {object} payload - the draw data (stroke or shape object)
 * @returns {{ id, seq_num }} inserted row metadata
 */
async function appendEvent(roomId, eventType, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomic per-room sequence increment.
    // UPDATE ... RETURNING holds a row-level lock — two concurrent calls get
    // different seq_nums. No SELECT MAX(seq_num)+1 race condition.
    const seqRes = await client.query(
      'SELECT next_seq_for_room($1) AS seq_num',
      [roomId]
    );
    const seqNum = seqRes.rows[0].seq_num;

    const { rows } = await client.query(
      `INSERT INTO draw_events (room_id, event_type, payload, seq_num)
       VALUES ($1, $2, $3, $4)
       RETURNING id, seq_num`,
      [roomId, eventType, JSON.stringify(payload), seqNum]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Event sourcing projection — folds the entire event log into canvas state.
 *
 * Rules applied in order:
 *   1. Events with undone=TRUE are skipped (logically deleted by undo)
 *   2. A 'clear' event resets the projection — everything before it is irrelevant
 *   3. 'stroke' and 'shape' events accumulate into their respective arrays
 *
 * This is a pure function: same event log → same canvas state, always.
 * It is the authoritative source of truth for board state on reconnect
 * and after every undo/redo.
 *
 * @param {string} roomId
 * @returns {{ strokes: object[], shapes: object[] }}
 */
async function replayRoom(roomId) {
  const { rows } = await pool.query(
    `SELECT event_type, payload, undone
     FROM draw_events
     WHERE room_id = $1
     ORDER BY seq_num ASC`,
    [roomId]
  );

  let strokes = [];
  let shapes  = [];

  for (const { event_type, payload, undone } of rows) {
    if (undone) continue; // logically deleted by undo — skip

    if (event_type === 'clear') {
      // Snapshot boundary — discard all prior accumulated state
      strokes = [];
      shapes  = [];
    } else if (event_type === 'stroke') {
      strokes.push(payload);
    } else if (event_type === 'shape') {
      shapes.push(payload);
    }
  }

  return { strokes, shapes };
}

/**
 * UNDO: Marks the last non-undone, non-clear event in this room as undone.
 *
 * Design: soft-delete (undone=TRUE), NOT physical delete.
 *   Physical delete would destroy the audit trail and make redo impossible.
 *   Soft-delete lets the projection skip the event while keeping it in the log.
 *
 * The UPDATE ... WHERE id = (subquery) is atomic:
 *   Postgres evaluates the subquery and acquires a row lock in one operation.
 *   No separate SELECT then UPDATE → no TOCTOU race condition.
 *
 * The idx_draw_events_undo index covers:
 *   WHERE room_id = $1 AND undone = FALSE ORDER BY seq_num DESC LIMIT 1
 *   making this an index seek, not a table scan.
 *
 * @param {string} roomId
 * @returns {{ id, event_type, seq_num }|null} the undone event, or null if nothing to undo
 */
async function undoLastEvent(roomId) {
  const { rows } = await pool.query(
    `UPDATE draw_events
     SET undone = TRUE, undone_at = NOW()
     WHERE id = (
       SELECT id FROM draw_events
       WHERE room_id = $1
         AND undone = FALSE
         AND event_type != 'clear'
       ORDER BY seq_num DESC
       LIMIT 1
     )
     RETURNING id, event_type, seq_num`,
    [roomId]
  );
  return rows[0] || null; // null means nothing left to undo
}

/**
 * REDO: Restores the most recently undone event in this room.
 *
 * "Most recently undone" = highest seq_num among undone=TRUE events.
 * This preserves the original draw order when redoing.
 *
 * @param {string} roomId
 * @returns {{ id, event_type, seq_num }|null} the restored event, or null if nothing to redo
 */
async function redoLastEvent(roomId) {
  const { rows } = await pool.query(
    `UPDATE draw_events
     SET undone = FALSE, undone_at = NULL
     WHERE id = (
       SELECT id FROM draw_events
       WHERE room_id = $1
         AND undone = TRUE
       ORDER BY seq_num DESC
       LIMIT 1
     )
     RETURNING id, event_type, seq_num`,
    [roomId]
  );
  return rows[0] || null; // null means nothing left to redo
}

module.exports = { appendEvent, replayRoom, undoLastEvent, redoLastEvent };
