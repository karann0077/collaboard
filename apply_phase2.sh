#!/bin/bash
set -e

cd /Users/DELL/Desktop/collab_board/server

mkdir -p presence snapshots rateLimit

# 1. Presence Service
cat << 'EJS' > presence/presenceService.js
const { createRedisClients } = require('../db/redis');

let pubClient = null;
const HEARTBEAT_INTERVAL = 15000;
const TTL_MS = HEARTBEAT_INTERVAL * 3;

async function getRedis() {
  if (!pubClient) {
    const clients = await createRedisClients();
    pubClient = clients.pubClient;
  }
  return pubClient;
}

async function registerPresence(roomId, connectionId, actorId, name, color) {
  const client = await getRedis();
  const expiry = Date.now() + TTL_MS;
  const multi = client.multi();
  multi.zAdd(`presence:${roomId}`, [{ score: expiry, value: connectionId }]);
  multi.hSet(`presence:${roomId}:${connectionId}`, ['actorId', actorId, 'name', name, 'color', color]);
  multi.pExpire(`presence:${roomId}:${connectionId}`, TTL_MS);
  await multi.exec();
}

async function heartbeat(roomId, connectionId) {
  const client = await getRedis();
  const expiry = Date.now() + TTL_MS;
  const multi = client.multi();
  multi.zAdd(`presence:${roomId}`, [{ score: expiry, value: connectionId }]);
  multi.pExpire(`presence:${roomId}:${connectionId}`, TTL_MS);
  await multi.exec();
}

async function removePresence(roomId, connectionId) {
  const client = await getRedis();
  const multi = client.multi();
  multi.zRem(`presence:${roomId}`, connectionId);
  multi.del(`presence:${roomId}:${connectionId}`);
  await multi.exec();
}

async function getPresence(roomId) {
  const client = await getRedis();
  const now = Date.now();
  
  // Clean up stale entries
  const expired = await client.zRangeByScore(`presence:${roomId}`, '-inf', now.toString());
  if (expired.length > 0) {
    const multi = client.multi();
    expired.forEach(connId => multi.del(`presence:${roomId}:${connId}`));
    multi.zRemRangeByScore(`presence:${roomId}`, '-inf', now.toString());
    await multi.exec();
  }

  // Get active members
  const activeConnIds = await client.zRangeByScore(`presence:${roomId}`, (now + 1).toString(), '+inf');
  if (activeConnIds.length === 0) return [];

  const multi = client.multi();
  activeConnIds.forEach(connId => multi.hGetAll(`presence:${roomId}:${connId}`));
  const results = await multi.exec();

  const participants = new Map();
  activeConnIds.forEach((connId, index) => {
    const data = results[index];
    if (data && data.actorId) {
       participants.set(data.actorId, { id: data.actorId, name: data.name, color: data.color });
    }
  });
  
  return Array.from(participants.values());
}

module.exports = { registerPresence, heartbeat, removePresence, getPresence };
EJS

# 2. Snapshot Service
cat << 'EJS' > snapshots/snapshotService.js
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
EJS

# 3. Rate Limiter
cat << 'EJS' > rateLimit/rateLimiter.js
const { createRedisClients } = require('../db/redis');
const { AppError } = require('../utils/errors');

let pubClient = null;
async function getRedis() {
  if (!pubClient) {
     const clients = await createRedisClients();
     pubClient = clients.pubClient;
  }
  return pubClient;
}

const LIMITS = {
  draw: { max: 50, window: 1 },
  cursor: { max: 30, window: 1 },
  control: { max: 10, window: 1 },
  clear: { max: 2, window: 60 }
};

async function checkRateLimit(actorId, operation) {
  const client = await getRedis();
  const config = LIMITS[operation] || LIMITS.draw;
  
  const currentWindow = Math.floor(Date.now() / (config.window * 1000));
  const key = `ratelimit:${actorId}:${operation}:${currentWindow}`;
  
  const multi = client.multi();
  multi.incr(key);
  multi.expire(key, config.window * 2);
  const results = await multi.exec();
  
  const currentCount = Array.isArray(results[0]) ? results[0][1] : results[0];
  
  if (currentCount > config.max) {
    throw new AppError('RATE_LIMITED', `Rate limit exceeded for ${operation}`, 429);
  }
}

module.exports = { checkRateLimit };
EJS

echo "Phase 2 services scaffolded."
