#!/bin/bash
set -e

cd /Users/DELL/Desktop/collab_board/server

mkdir -p websocket config events auth

# 1. Fix eventService.js
cat << 'EJS' > services/eventService.js
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
EJS

# 2. Fix eventValidator.js
cat << 'EJS' > events/eventValidator.js
const { DOMAIN_EVENT_TYPES } = require('@collaboard/shared');
const { AppError } = require('../utils/errors');

const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,64}$/;
const OBJECT_ID = /^obj_[A-Za-z0-9_-]{8,64}$/;
const finite = (n) => Number.isFinite(n) && n >= 0 && n <= 32767;

function validatePoint(point) {
  return point && finite(point.x) && finite(point.y);
}

function validateCommand(command) {
  if (!command || typeof command !== 'object' || typeof command.requestId !== 'string' || !command.requestId) {
    throw new AppError('INVALID_PAYLOAD', 'requestId is required');
  }
  if (command.roomId !== undefined) {
    throw new AppError('INVALID_PAYLOAD', 'command.roomId must not be set by client');
  }
  if (!EVENT_ID.test(command.eventId || '')) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid eventId');
  }
  if (!DOMAIN_EVENT_TYPES.has(command.type)) {
    throw new AppError('INVALID_PAYLOAD', 'Unsupported command type');
  }

  const payload = command.payload || {};
  if (typeof payload !== 'object' || Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid payload size or format');
  }

  if (["stroke.created", "shape.created", "text.created", "object.updated", "object.deleted"].includes(command.type)) {
    if (!OBJECT_ID.test(payload.objectId || '')) throw new AppError('INVALID_PAYLOAD', 'Invalid objectId');
  }

  if (command.type === 'stroke.created') {
    if (!Array.isArray(payload.path) || payload.path.length < 1 || payload.path.length > 2000 || !payload.path.every(validatePoint)) {
      throw new AppError('INVALID_PAYLOAD', 'Invalid stroke path');
    }
  } else if (command.type === 'shape.created') {
    if (!['rect', 'circle', 'line', 'arrow'].includes(payload.type)) throw new AppError('INVALID_PAYLOAD', 'Invalid shape type');
    if (payload.type === 'rect' && (!finite(payload.x) || !finite(payload.y) || !finite(payload.w) || !finite(payload.h))) throw new AppError('INVALID_PAYLOAD', 'Invalid rect coordinates');
    if (payload.type === 'circle' && (!finite(payload.x) || !finite(payload.y) || !finite(payload.r))) throw new AppError('INVALID_PAYLOAD', 'Invalid circle coordinates');
    if (['line', 'arrow'].includes(payload.type) && (!finite(payload.x1) || !finite(payload.y1) || !finite(payload.x2) || !finite(payload.y2))) throw new AppError('INVALID_PAYLOAD', 'Invalid line coordinates');
  } else if (command.type === 'text.created') {
    if (typeof payload.text !== 'string' || payload.text.length > 1000) throw new AppError('INVALID_PAYLOAD', 'Invalid text');
    if (!finite(payload.x) || !finite(payload.y)) throw new AppError('INVALID_PAYLOAD', 'Invalid text coordinates');
  } else if (command.type === 'board.cleared') {
    if (Object.keys(payload).length > 0) throw new AppError('INVALID_PAYLOAD', 'board.cleared payload must be empty');
  }

  if (payload.width !== undefined && (!Number.isFinite(payload.width) || payload.width < 1 || payload.width > 50)) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid width');
  }
  if (payload.style !== undefined && !['solid', 'dashed', 'dotted'].includes(payload.style)) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid style');
  }

  return payload;
}

module.exports = { validateCommand };
EJS

# 3. Fix sessionService.js
cat << 'EJS' > auth/sessionService.js
const crypto = require('crypto');
const { AppError } = require('../utils/errors');
const COOKIE = 'collaboard_session';

function sign(actorId) { 
  return `${actorId}.${crypto.createHmac('sha256', process.env.SESSION_SECRET || 'development-only-change-me').update(actorId).digest('base64url')}`; 
}

function verify(value) { 
  if (!value || !value.includes('.')) return null; 
  const [actorId, signature] = value.split('.'); 
  const expected = sign(actorId).split('.')[1]; 
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? actorId : null; 
}

function parseCookies(header = '') { 
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key)); 
}

function issueSession(res) { 
  const actorId = `ses_${crypto.randomBytes(12).toString('base64url')}`; 
  res.cookie(COOKIE, sign(actorId), { 
    httpOnly: true, 
    secure: process.env.NODE_ENV === 'production', 
    sameSite: 'strict', 
    maxAge: 86400000, 
    path: '/' 
  }); 
  return actorId; 
}

function httpSession(req, res, next) { 
  req.actorId = verify(parseCookies(req.headers.cookie)[COOKIE]) || issueSession(res); 
  next(); 
}

function socketSession(socket, next) { 
  const actorId = verify(parseCookies(socket.handshake.headers.cookie)[COOKIE]);
  if (!actorId) {
    return next(new Error('AUTH_REQUIRED'));
  }
  socket.actorId = actorId;
  next(); 
}

module.exports = { httpSession, socketSession };
EJS

# 4. Refactor index.js
cat << 'EJS' > index.js
require('dotenv').config();
const express = require('express'); 
const http = require('http'); 
const cors = require('cors');
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
const { httpSession, socketSession } = require('./auth/sessionService'); 
const { startRoomGC } = require('./jobs/roomGC');

const app = express(); 
const server = http.createServer(app);

const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const corsOptions = { origin: allowedOrigin, credentials: true, methods: ['GET', 'POST'] };

const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 64 * 1024 });
app.use(cors(corsOptions)); 
app.use(express.json({ limit: '64kb' })); 
app.use(httpSession);

const users = new Map(); // Phase 1 presence placeholder keyed by actorId
const colors = ['#ef4444','#f97316','#f59e0b','#10b981','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
const colorFor = (id) => colors[Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colors.length];
const participants = (roomId) => {
  const roomUsers = users.get(roomId) || new Map();
  return Array.from(roomUsers.values());
};

function emitError(socket, command, error) { 
  socket.emit('command-ack', { 
    requestId: command && command.requestId, 
    status: 'rejected', 
    code: error.code || 'INTERNAL_ERROR', 
    message: error.message || 'Unable to process command' 
  }); 
}

function eventForWire(row) { return row.eventId ? row : normalize(row); }

app.get('/create-room', async (_req, res) => { 
  try { res.json({ roomId: await createRoom() }); } 
  catch (error) { res.status(500).json({ error: 'Failed to create room' }); } 
});

app.get('/api/session', (req, res) => {
  res.json({ actorId: req.actorId });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

io.use(socketSession);

io.on('connection', (socket) => {
  socket.on('join-room', async ({ roomId, name } = {}) => {
    try {
      if (!/^[A-Za-z0-9_-]{8}$/.test(roomId || '') || typeof name !== 'string' || !name.trim()) throw new AppError('INVALID_PAYLOAD', 'Valid roomId and name are required');
      if (!await roomExists(roomId)) return socket.emit('room-not-found');
      
      socket.join(roomId); 
      socket.data.roomId = roomId;
      
      if (!users.has(roomId)) users.set(roomId, new Map());
      
      const user = { id: socket.actorId, name: name.trim().slice(0, 80), color: colorFor(socket.actorId) }; 
      users.get(roomId).set(socket.actorId, user);
      
      const baseSeq = await getRoomVersion(roomId); 
      const document = await replayRoom(roomId, baseSeq);
      
      socket.emit('initial-state', { document, baseSeq, assignedColor: user.color, participants: participants(roomId) });
      io.to(roomId).emit('participants', participants(roomId));
    } catch (error) { 
      socket.emit('error-message', error.message); 
    }
  });

  socket.on('command', async (command = {}) => {
    try {
      const roomId = socket.data.roomId; 
      if (!roomId) throw new AppError('NOT_JOINED', 'Join a room before sending commands'); 

      let event;
      if (command.type === 'undo') event = await undoForActor(roomId, socket.actorId, command.eventId);
      else if (command.type === 'redo') event = await redoForActor(roomId, socket.actorId, command.eventId);
      else { 
        const payload = validateCommand(command); 
        event = await appendEvent(roomId, command.type, payload, socket.actorId, command.eventId); 
      }
      
      if (!event) return socket.emit('command-ack', { requestId: command.requestId, status: 'rejected', code: 'NOTHING_TO_DO', message: 'No applicable event found' });
      
      const wireEvent = eventForWire(event);
      socket.emit('command-ack', { requestId: command.requestId, status: 'committed', seq: wireEvent.seq, eventId: wireEvent.eventId });
      io.to(roomId).emit('event-committed', wireEvent);
      
      if (command.type !== 'undo' && command.type !== 'redo') {
        touchRoom(roomId).catch(console.error);
      }
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
        // Client is somehow ahead of server's current committed state. Not an error to crash on, just ignore or tell client to wait.
        return socket.emit('sync-response', { mode: 'events', currentSeq: baseSeq, events: [] });
      }

      // Delta sync for now (Phase 1)
      const pool = require('./db/postgres');
      const { normalize } = require('./collaboration/projectionService');
      const { rows } = await pool.query('SELECT * FROM events WHERE room_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq ASC', [roomId, reqSeq, baseSeq]);
      
      socket.emit('sync-response', { 
        mode: 'events', 
        currentSeq: baseSeq, 
        events: rows.map(normalize) 
      }); 
    } catch (error) { 
      socket.emit('error-message', error.message); 
    }
  });

  socket.on('cursor-move', ({ x, y } = {}) => { 
    const roomId = socket.data.roomId; 
    if (!roomId || !Number.isFinite(x) || !Number.isFinite(y)) return; 
    const user = users.get(roomId)?.get(socket.actorId); 
    if (user) socket.to(roomId).emit('remote-cursor', { id: socket.id, ...user, x, y }); 
  });

  socket.on('disconnect', () => { 
    const roomId = socket.data.roomId; 
    if (!roomId) return; 
    
    // For Phase 1, we just remove them from in-memory map.
    // If they have multiple tabs, this might remove them prematurely (Phase 2 fixes this).
    users.get(roomId)?.delete(socket.actorId); 
    if (users.get(roomId)?.size === 0) users.delete(roomId); 
    io.to(roomId).emit('participants', participants(roomId)); 
  });
});

async function bootstrap() { 
  const { pubClient, subClient } = await createRedisClients(); 
  io.adapter(createAdapter(pubClient, subClient)); 
  startRoomGC(); 
  server.listen(process.env.PORT || 4000, () => console.log(`Server listening on ${process.env.PORT || 4000}`)); 
}
bootstrap().catch((error) => { console.error('Startup failed', error); process.exit(1); });
EJS

echo "Server backend successfully patched for Phase 1!"
