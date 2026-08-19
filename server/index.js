require('dotenv').config();
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const { Server }             = require('socket.io');
const { createAdapter }      = require('@socket.io/redis-adapter');
const { createRedisClients } = require('./db/redis');
const { createRoom, roomExists, touchRoom } = require('./services/roomService');
const { appendEvent, replayRoom, undoLastEvent, redoLastEvent } =
  require('./services/eventService');
const { startRoomGC } = require('./jobs/roomGC');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || '*' }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ── Ephemeral presence only ────────────────────────────────────────────────────
// Users/cursors are transient — no DB needed. If a user disconnects, they're gone.
// Persisting presence would be over-engineering with no benefit.
// ──────────────────────────────────────────────────────────────────────────────
const roomUsers = new Map(); // roomId → Map<socketId, { name, color }>

function randomColor() {
  const colors = [
    '#ef4444','#f97316','#f59e0b','#eab308','#84cc16',
    '#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Bootstrap: connect Redis before accepting any connections ──────────────────
// This ensures no Socket.IO events are processed without the Redis adapter ready.
// If Redis is down, we fail fast on startup rather than silently degrading.
// ──────────────────────────────────────────────────────────────────────────────
async function bootstrap() {
  const { pubClient, subClient } = await createRedisClients();

  // Attach Redis adapter — makes io.to(room).emit() work across ALL server instances.
  // Under the hood: publishes to Redis channel; each instance subscribes and
  // forwards the message to its local Socket.IO clients in that room.
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter attached');

  // Start room GC cron — runs in background, non-blocking
  startRoomGC();

  // ── HTTP Routes ──────────────────────────────────────────────────────────────

  app.get('/create-room', async (req, res) => {
    try {
      const roomId = await createRoom(); // persists to Postgres
      res.json({ roomId });
    } catch (err) {
      console.error('create-room error:', err);
      res.status(500).json({ error: 'Failed to create room' });
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ── Socket.IO Events ─────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    console.log('connected:', socket.id);

    // ── join-room ──────────────────────────────────────────────────────────────
    socket.on('join-room', async ({ roomId, name }) => {
      if (!roomId || !name) {
        return socket.emit('error-message', 'roomId and name are required');
      }

      // Validate room exists in Postgres — not just in-memory
      const exists = await roomExists(roomId);
      if (!exists) return socket.emit('room-not-found');

      // Join Socket.IO room — Redis adapter makes this cross-instance
      socket.join(roomId);

      // Register ephemeral presence
      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
      const color = randomColor();
      roomUsers.get(roomId).set(socket.id, { name, color });

      // Replay full event log from Postgres to reconstruct board state
      const { strokes, shapes } = await replayRoom(roomId);
      const participants = [...roomUsers.get(roomId).values()].map((u, i) => ({
        id: [...roomUsers.get(roomId).keys()][i],
        name: u.name,
        color: u.color
      }));

      socket.emit('initial-state', {
        strokes, shapes, assignedColor: color, participants
      });
      io.to(roomId).emit('participants', participants);

      // Update last_active (fire-and-forget, non-blocking)
      touchRoom(roomId).catch(console.error);
    });

    // ── draw-stroke ────────────────────────────────────────────────────────────
    // Kept as 'draw-stroke' to match existing client emit name
    socket.on('draw-stroke', async ({ roomId, stroke }) => {
      if (!roomId || !stroke) return;
      // 1. Persist to Postgres (durable, sequenced)
      await appendEvent(roomId, 'stroke', stroke);
      // 2. Broadcast to all OTHER clients — Redis adapter handles cross-instance
      socket.to(roomId).emit('remote-stroke', stroke);
    });

    // ── create-shape ───────────────────────────────────────────────────────────
    socket.on('create-shape', async ({ roomId, shape }) => {
      if (!roomId || !shape) return;
      await appendEvent(roomId, 'shape', shape);
      socket.to(roomId).emit('shape-created', shape);
    });

    // ── cursor-move ────────────────────────────────────────────────────────────
    // Cursors: ephemeral, NOT persisted — fire-and-forget via Redis pub/sub
    socket.on('cursor-move', ({ roomId, x, y }) => {
      if (!roomId) return;
      const users = roomUsers.get(roomId);
      const user  = users && users.get(socket.id);
      if (!user) return;
      socket.to(roomId).emit('remote-cursor', {
        id: socket.id, name: user.name, color: user.color, x, y
      });
    });

    // ── clear-board ────────────────────────────────────────────────────────────
    // 'clear' is stored as an event — the projection resets state arrays when
    // it encounters one. Events before it remain in the log for audit purposes.
    socket.on('clear-board', async ({ roomId }) => {
      if (!roomId) return;
      await appendEvent(roomId, 'clear', {});
      io.to(roomId).emit('clear-board');
    });

    // ── undo ──────────────────────────────────────────────────────────────────
    // Server-authoritative undo:
    //   1. Soft-delete the last non-undone event (undone=TRUE)
    //   2. Re-project the full event log into canvas state
    //   3. Broadcast authoritative board-state to ALL users in room
    // This ensures everyone sees the same board — no split-brain undo.
    socket.on('undo', async ({ roomId }) => {
      if (!roomId) return;
      const undone = await undoLastEvent(roomId);
      if (!undone) return; // nothing to undo

      const { strokes, shapes } = await replayRoom(roomId);
      io.to(roomId).emit('board-state', { strokes, shapes });
    });

    // ── redo ──────────────────────────────────────────────────────────────────
    // Mirrors undo: restores the most recently undone event and re-projects.
    socket.on('redo', async ({ roomId }) => {
      if (!roomId) return;
      const redone = await redoLastEvent(roomId);
      if (!redone) return; // nothing to redo

      const { strokes, shapes } = await replayRoom(roomId);
      io.to(roomId).emit('board-state', { strokes, shapes });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      for (const [roomId, users] of roomUsers.entries()) {
        if (users.has(socket.id)) {
          const name = users.get(socket.id)?.name;
          users.delete(socket.id);
          const participants = [...users.entries()].map(([id, u]) => ({
            id, name: u.name, color: u.color
          }));
          io.to(roomId).emit('participants', participants);
          io.to(roomId).emit('user-left', { id: socket.id, name });
          if (users.size === 0) roomUsers.delete(roomId);
        }
      }
      console.log('disconnected:', socket.id);
    });
  });

  server.listen(PORT, () => console.log(`Server on :${PORT}`));
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
