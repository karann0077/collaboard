const { Pool } = require('pg');

// Pool maintains a set of reusable connections.
// Never create a new Client per-query in Node —
// TCP handshake + auth overhead makes per-query connections ~10x slower.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render/Supabase/Railway all require SSL in production
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,                     // max pool size; tune vs Postgres max_connections
  idleTimeoutMillis: 30000,    // close idle connections after 30s
  connectionTimeoutMillis: 2000, // fail fast if pool exhausted
});

// Fail immediately on unexpected pool errors — don't serve traffic with a broken pool
pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
  process.exit(-1);
});

module.exports = pool;
