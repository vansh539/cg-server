'use strict';

// Paths reachable without a session -- just enough for the login page itself
// to render (its own HTML, shared styles/logo/manifest) plus the auth API.
const PUBLIC_PATHS = new Set(['/login.html', '/styles.css', '/manifest.json', '/sw.js', '/expired.html']);
const PUBLIC_PREFIXES = ['/assets/', '/api/auth/'];

function isPublicPath(urlPath) {
  if (PUBLIC_PATHS.has(urlPath)) return true;
  return PUBLIC_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

function requireSession(req, res, next) {
  if (isPublicPath(req.path)) return next();
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Not signed in' });
  }
  return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Not signed in' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Only an admin can do this' });
  }
  next();
}

module.exports = { requireSession, requireAdmin };
