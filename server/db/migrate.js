require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const MIGRATION_TABLE = 'schema_migrations';

async function tableExists(client, tableName) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return rows[0].exists;
}

async function baselineExistingSchema(client, files) {
  const existing = new Set();
  const [rooms, events, archivedEvents, users] = await Promise.all([
    tableExists(client, 'rooms'),
    tableExists(client, 'events'),
    tableExists(client, 'draw_events_archived'),
    tableExists(client, 'users')
  ]);

  // The repository originally created the base rooms/draw_events schema in 001.
  if (rooms) existing.add('001_init.sql');
  if (events) existing.add('002_canonical.sql');
  if (archivedEvents) existing.add('002_migrate_draw_events.sql');
  if (users) existing.add('003_auth.sql');

  for (const name of existing) {
    if (files.includes(name)) {
      await client.query(
        `INSERT INTO ${MIGRATION_TABLE} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }
  }
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Render may already contain a database created by the older migration
    // runner, which had no migration-history table. Record the schema state
    // before executing anything so old migrations are not repeated.
    await baselineExistingSchema(client, files);

    for (const file of files) {
      const { rows } = await client.query(
        `SELECT 1 FROM ${MIGRATION_TABLE} WHERE name = $1`,
        [file]
      );
      if (rows.length > 0) {
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }

      console.log(`Running migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATION_TABLE} (name) VALUES ($1)`,
          [file]
        );
        await client.query('COMMIT');
        console.log(`Finished: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('All migrations applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
