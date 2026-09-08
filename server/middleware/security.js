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
