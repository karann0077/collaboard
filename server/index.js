require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createRedisClients } = require('./db/redis');
const { createRoom, roomExists, touchRoom } = require('./services/roomService');
const { appendEvent } = require('./services/eventService');
const { replayRoom, getRoomVersion, normalize } = require('./collaboration/projectionService');
const { undoForActor } = require('./collaboration/undoService');
const { redoForActor } = require('./collaboration/redoService');
const { validateCommand } = require('./events/eventValidator');
const { AppError } = require('./utils/errors');
const { startRoomGC } = require('./jobs/roomGC');

const { registerPresence, heartbeat, removePresence, getPresence } = require('./presence/presenceService');
const { triggerSnapshotCheck, getLatestSnapshot } = require('./snapshots/snapshotService');
const { checkRateLimit } = require('./rateLimit/rateLimiter');

const { requireAuth, socketSession } = require('./auth/sessionService');
const { guest, register, login, logout, me } = require('./auth/authController');
const { getMemberRole, createInvite, redeemInvite } = require('./rooms/memberService');
const { csrfProtection } = require('./middleware/security');

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const corsOptions = { origin: allowedOrigin, credentials: true, methods: ['GET', 'POST'] };

const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 64 * 1024 });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '64kb' }));
app.use(csrfProtection(allowedOrigin));

const colors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const colorFor = (id) => colors[Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colors.length];

function emitError(socket, command, error) {
  socket.emit('command-ack', {
    requestId: command && command.requestId,
    status: 'rejected',
    code: error.code || 'INTERNAL_ERROR',
    message: error.message || 'Unable to process command'
  });
}

function eventForWire(row) {
  return row.eventId ? row : normalize(row);
}

app.post('/api/auth/guest', guest);
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', requireAuth, me);

app.post('/api/rooms', requireAuth, async (req, res) => {
  try {
    res.json({ roomId: await createRoom(req.actorId) });
  } catch (error) {
    console.error('[Room create]', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.post('/api/rooms/:roomId/invites', requireAuth, async (req, res) => {
  try {
    const role = await getMemberRole(req.params.roomId, req.actorId);
    if (role !== 'owner') return res.status(403).json({ error: 'Only owners can invite' });
    const inviteRole = req.body.role || 'editor';
    const code = await createInvite(req.params.roomId, req.actorId, inviteRole);
    res.json({ inviteCode: code });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/invites/:code/redeem', requireAuth, async (req, res) => {
  try {
    const roomId = await redeemInvite(req.params.code, req.actorId);
    res.json({ roomId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

io.use(socketSession);

io.on('connection', (socket) => {
  socket.on('join-room', async ({ roomId, name } = {}) => {
    try {
      if (!/^[A-Za-z0-9_-]{8}$/.test(roomId || '') || typeof name !== 'string' || !name.trim()) {
        throw new AppError('INVALID_PAYLOAD', 'Valid roomId and name are required');
      }
      if (!await roomExists(roomId)) return socket.emit('room-not-found');

      const role = await getMemberRole(roomId, socket.actorId) || 'viewer';
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = role;

      const userColor = colorFor(socket.actorId);
      await registerPresence(roomId, socket.id, socket.actorId, name.trim().slice(0, 80), userColor);

      const baseSeq = await getRoomVersion(roomId);
      const document = await replayRoom(roomId, baseSeq);
      const participants = await getPresence(roomId);

      socket.emit('initial-state', { document, baseSeq, assignedColor: userColor, participants, role });
      io.to(roomId).emit('participants', participants);
    } catch (error) {
      socket.emit('error-message', error.message);
    }
  });

  socket.on('heartbeat', async () => {
    const roomId = socket.data.roomId;
    if (roomId) await heartbeat(roomId, socket.id).catch(console.error);
  });

  socket.on('command', async (command = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) throw new AppError('NOT_JOINED', 'Join a room before sending commands');

      if (socket.data.role === 'viewer') {
        throw new AppError('UNAUTHORIZED', 'Viewers cannot modify the board', 403);
      }

      let opType = 'draw';
      if (command.type === 'undo' || command.type === 'redo') opType = 'control';
      else if (command.type === 'board.cleared') opType = 'clear';
      await checkRateLimit(socket.actorId, opType);

      let event;
      if (command.type === 'undo') event = await undoForActor(roomId, socket.actorId, command.eventId);
      else if (command.type === 'redo') event = await redoForActor(roomId, socket.actorId, command.eventId);
      else {
        const payload = validateCommand(command);
        event = await appendEvent(roomId, command.type, payload, socket.actorId, command.eventId);
      }

      if (!event) {
        return socket.emit('command-ack', {
          requestId: command.requestId,
          status: 'rejected',
          code: 'NOTHING_TO_DO',
          message: 'No applicable event found'
        });
      }

      const wireEvent = eventForWire(event);
      socket.emit('command-ack', {
        requestId: command.requestId,
        status: 'committed',
        seq: wireEvent.seq,
        eventId: wireEvent.eventId
      });
      io.to(roomId).emit('event-committed', wireEvent);

      if (command.type !== 'undo' && command.type !== 'redo') {
        touchRoom(roomId).catch(console.error);
      }
      triggerSnapshotCheck(roomId, wireEvent.seq);
    } catch (error) {
      emitError(socket, command, error);
    }
  });

  socket.on('sync-request', async ({ lastSeq } = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) throw new AppError('NOT_JOINED', 'Join a room first');

      const baseSeq = await getRoomVersion(roomId);
      const reqSeq = Number(lastSeq || 0);

      if (baseSeq < reqSeq) {
        return socket.emit('sync-response', { mode: 'events', currentSeq: baseSeq, events: [] });
      }

      const GAP_THRESHOLD = 50;
      if (baseSeq - reqSeq > GAP_THRESHOLD || reqSeq === 0) {
        const snapshot = await getLatestSnapshot(roomId);
        if (snapshot && snapshot.seq >= reqSeq) {
          return socket.emit('sync-response', { mode: 'snapshot', snapshot });
        }
      }

      const pool = require('./db/postgres');
      const { rows } = await pool.query(
        'SELECT * FROM events WHERE room_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq ASC',
        [roomId, reqSeq, baseSeq]
      );

      socket.emit('sync-response', {
        mode: 'events',
        currentSeq: baseSeq,
        events: rows.map(normalize)
      });
    } catch (error) {
      socket.emit('error-message', error.message);
    }
  });

  socket.on('cursor-move', async ({ x, y } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (socket.data.role === 'viewer') return;

    try {
      await checkRateLimit(socket.actorId, 'cursor');
    } catch (_err) {
      return;
    }

    const userColor = colorFor(socket.actorId);
    socket.to(roomId).emit('remote-cursor', {
      id: socket.id,
      actorId: socket.actorId,
      color: userColor,
      x,
      y
    });
  });

  socket.on('disconnect', async () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    try {
      await removePresence(roomId, socket.id);
      const participants = await getPresence(roomId);
      io.to(roomId).emit('participants', participants);
    } catch (error) {
      console.error('[Presence disconnect]', error);
    }
  });
});

async function bootstrap() {
  const { pubClient, subClient } = await createRedisClients();
  io.adapter(createAdapter(pubClient, subClient));
  startRoomGC();
  server.listen(process.env.PORT || 4000, () => console.log(`Server listening on ${process.env.PORT || 4000}`));
}

bootstrap().catch((error) => {
  console.error('Startup failed', error);
  process.exit(1);
});
