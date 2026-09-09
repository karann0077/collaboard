/**
 * CSRF protection middleware.
 *
 * For state-changing methods (POST, PUT, DELETE, PATCH):
 * - Requires Origin or Referer header to be present.
 * - Origin is validated by exact string match against allowedOrigin.
 * - Referer is validated by parsing its origin (protocol + host + port)
 *   and comparing to allowedOrigin. (Bug #29 fix — previously the Referer
 *   was not actually origin-parsed, only its presence was checked.)
 */
function csrfProtection(allowedOrigin) {
  return (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.get('Origin');
      const referer = req.get('Referer');

      if (!origin && !referer) {
        return res.status(403).json({ error: 'CSRF token missing or incorrect origin' });
      }

      if (origin && origin !== allowedOrigin) {
        return res.status(403).json({ error: 'CSRF Origin mismatch' });
      }

      // Only validate Referer when Origin is absent (browsers that don't send Origin)
      if (!origin && referer) {
        let refererOrigin;
        try {
          refererOrigin = new URL(referer).origin;
        } catch {
          return res.status(403).json({ error: 'CSRF Referer invalid' });
        }
        if (refererOrigin !== allowedOrigin) {
          return res.status(403).json({ error: 'CSRF Referer mismatch' });
        }
      }
    }
    next();
  };
}

module.exports = { csrfProtection };
