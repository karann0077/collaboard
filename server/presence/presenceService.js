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
