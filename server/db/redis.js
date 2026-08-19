const { createClient } = require('redis');

/**
 * Creates and connects two Redis clients required by the Socket.IO Redis adapter.
 *
 * Why two clients?
 *   Redis mandates separate connections for pub and sub.
 *   A subscribed connection enters a special mode where it can ONLY receive
 *   messages — it cannot run any other commands (GET, SET, etc.).
 *   The pubClient handles all non-sub operations; subClient is exclusively
 *   for the adapter's subscription channel.
 *
 * @returns {{ pubClient, subClient }}
 */
async function createRedisClients() {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  // .duplicate() creates a new client with the same config and a fresh TCP connection
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('Redis pub error:', err));
  subClient.on('error', (err) => console.error('Redis sub error:', err));

  await pubClient.connect();
  await subClient.connect();
  console.log('Redis connected (pub + sub)');

  return { pubClient, subClient };
}

module.exports = { createRedisClients };
