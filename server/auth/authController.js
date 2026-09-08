const crypto = require('crypto');
const pool = require('../db/postgres');
const { issueSession, clearSession } = require('./sessionService');
const { nanoid } = require('nanoid');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  return crypto.timingSafeEqual(derivedKey, keyBuffer);
}

async function register(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
  
  const userId = `usr_${nanoid(12)}`;
  const hash = hashPassword(password);
  
  try {
    await pool.query(
      'INSERT INTO users (user_id, email, password_hash, name) VALUES ($1, $2, $3, $4)',
      [userId, email.toLowerCase(), hash, name.trim()]
    );
    issueSession(res, userId);
    res.json({ userId, name: name.trim() });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Internal error' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const { rows } = await pool.query('SELECT user_id, password_hash, name FROM users WHERE email = $1', [email.toLowerCase()]);
  if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  issueSession(res, rows[0].user_id);
  res.json({ userId: rows[0].user_id, name: rows[0].name });
}

async function logout(req, res) {
  clearSession(res);
  res.json({ ok: true });
}

async function me(req, res) {
  const { rows } = await pool.query('SELECT user_id, email, name FROM users WHERE user_id = $1', [req.actorId]);
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
}

module.exports = { register, login, logout, me };
