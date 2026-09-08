#!/bin/bash
set -e

cd /Users/DELL/Desktop/collab_board/server

mkdir -p db/migrations auth rooms middleware

# 1. Database Migration
cat << 'EJS' > db/migrations/003_auth.sql
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id VARCHAR(8) REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_invites (
  invite_code TEXT PRIMARY KEY,
  room_id VARCHAR(8) REFERENCES rooms(room_id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
EJS

# 2. Update Session Service
cat << 'EJS' > auth/sessionService.js
const crypto = require('crypto');
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

function issueSession(res, actorId) { 
  res.cookie(COOKIE, sign(actorId), { 
    httpOnly: true, 
    secure: process.env.NODE_ENV === 'production', 
    sameSite: 'strict', 
    maxAge: 86400000, 
    path: '/' 
  }); 
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAuth(req, res, next) { 
  const actorId = verify(parseCookies(req.headers.cookie)[COOKIE]);
  if (!actorId) return res.status(401).json({ error: 'Unauthorized. Please login.' });
  req.actorId = actorId;
  next(); 
}

function optionalAuth(req, res, next) {
  req.actorId = verify(parseCookies(req.headers.cookie)[COOKIE]);
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

module.exports = { issueSession, clearSession, requireAuth, optionalAuth, socketSession };
EJS

# 3. Auth Controller
cat << 'EJS' > auth/authController.js
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
EJS

# 4. Member Service & Room Service Updates
cat << 'EJS' > rooms/memberService.js
const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

async function getMemberRole(roomId, userId) {
  const { rows } = await pool.query('SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
  return rows.length ? rows[0].role : null;
}

async function addMember(roomId, userId, role) {
  await pool.query(
    'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role',
    [roomId, userId, role]
  );
}

async function createInvite(roomId, createdBy, role, expiresInHours = 24) {
  const inviteCode = `inv_${nanoid(16)}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000);
  await pool.query(
    'INSERT INTO room_invites (invite_code, room_id, created_by, role, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [inviteCode, roomId, createdBy, role, expiresAt]
  );
  return inviteCode;
}

async function redeemInvite(inviteCode, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT room_id, role, expires_at FROM room_invites WHERE invite_code = $1 FOR UPDATE', [inviteCode]);
    if (rows.length === 0) throw new Error('Invalid invite code');
    if (new Date() > new Date(rows[0].expires_at)) throw new Error('Invite expired');
    
    await client.query(
      'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING',
      [rows[0].room_id, userId, rows[0].role]
    );
    await client.query('COMMIT');
    return rows[0].room_id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getMemberRole, addMember, createInvite, redeemInvite };
EJS

cat << 'EJS' > services/roomService.js
const pool = require('../db/postgres');
const { nanoid } = require('nanoid');

async function createRoom(userId) {
  const roomId = nanoid(8);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO rooms (room_id) VALUES ($1)', [roomId]);
    await client.query('INSERT INTO room_sequences (room_id, next_seq) VALUES ($1, 1)', [roomId]);
    
    if (userId) {
      await client.query('INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)', [roomId, userId, 'owner']);
    }
    
    await client.query('COMMIT');
    return roomId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function roomExists(roomId) {
  const { rows } = await pool.query('SELECT 1 FROM rooms WHERE room_id = $1', [roomId]);
  return rows.length > 0;
}

async function touchRoom(roomId) {
  await pool.query('UPDATE rooms SET last_active = NOW() WHERE room_id = $1', [roomId]);
}

module.exports = { createRoom, roomExists, touchRoom };
EJS

# 5. Security Middleware
cat << 'EJS' > middleware/security.js
function csrfProtection(allowedOrigin) {
  return (req, res, next) => {
    // Basic CSRF: For state-changing methods, require Origin or Referer to match exactly
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.get('Origin');
      const referer = req.get('Referer');
      
      if (!origin && !referer) {
        return res.status(403).json({ error: 'CSRF token missing or incorrect origin' });
      }
      
      if (origin && origin !== allowedOrigin) {
        return res.status(403).json({ error: 'CSRF Origin mismatch' });
      }
    }
    next();
  };
}
module.exports = { csrfProtection };
EJS

echo "Dependencies and files for Phase 3 ready."
