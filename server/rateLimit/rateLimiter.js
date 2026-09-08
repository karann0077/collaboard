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
