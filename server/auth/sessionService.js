const crypto = require('crypto');
const { nanoid } = require('nanoid');

const COOKIE = 'collaboard_session';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }
  return secret || 'development-only-change-me';
}

function sign(actorId) {
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(actorId)
    .digest('base64url');
  return `${actorId}.${signature}`;
}

function verify(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;

  const separator = value.lastIndexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;

  const actorId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(actorId).slice(actorId.length + 1);

  if (signature.length !== expected.length) return null;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  ) ? actorId : null;
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

function cookieOptions() {
  const production = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    // Vercel and Render are different sites in production, so SameSite=None
    // is required for the browser to send the session cookie to the API/socket.
    sameSite: production ? 'none' : 'lax',
    maxAge: MAX_AGE_MS,
    path: '/'
  };
}

function getSessionActorId(req) {
  return verify(parseCookies(req.headers.cookie)[COOKIE]);
}

function issueSession(res, actorId) {
  res.cookie(COOKIE, sign(actorId), cookieOptions());
}

function issueGuestSession(res) {
  const actorId = `ses_${nanoid(16)}`;
  issueSession(res, actorId);
  return actorId;
}

function clearSession(res) {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(COOKIE, options);
}

function requireAuth(req, res, next) {
  const actorId = getSessionActorId(req);
  if (!actorId) return res.status(401).json({ error: 'Unauthorized. Please login.' });
  req.actorId = actorId;
  next();
}

function optionalAuth(req, _res, next) {
  req.actorId = getSessionActorId(req);
  next();
}

function socketSession(socket, next) {
  const actorId = verify(parseCookies(socket.handshake.headers.cookie)[COOKIE]);
  if (!actorId) return next(new Error('AUTH_REQUIRED'));
  socket.actorId = actorId;
  next();
}

module.exports = {
  issueSession,
  issueGuestSession,
  clearSession,
  getSessionActorId,
  requireAuth,
  optionalAuth,
  socketSession
};
