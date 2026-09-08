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
