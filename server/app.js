// Express app assembly: cross-cutting middleware, route modules, static client
// and error handling. Domain logic lives in services/, endpoints in routes/.
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';
import { UnsupportedFileError } from './content.js';
import { createSession } from './session.js';
import { createDocumentService } from './services/documents.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { sharingRoutes } from './routes/sharing.js';
import { uploadRoutes } from './routes/uploads.js';
import { versionRoutes } from './routes/versions.js';
import { presenceRoutes, createPresenceStore } from './routes/presence.js';
import { systemRoutes } from './routes/system.js';

const REQUEST_ID_RE = /^[\w-]{1,64}$/;

/**
 * Build the Express app. Every limit is injectable (see server/config.js for the
 * environment variables that set them in production); defaults suit tests.
 */
export function createApp({
  db,
  jwtSecret,
  clientDist,
  loginAttemptsPerWindow = 10,
  logRequests = false,
  maxVersionsPerDoc = 100,
  sessionDays = 7,
  allowSignup = true,
  signupsPerHour = 10,
  uploadsPerMinute = 20,
  maxUploadBytes = 2 * 1024 * 1024,
  // Autosaves by the same person within this window are folded into one history
  // entry (like an "editing session"), so history stays readable.
  versionSessionMs = 5 * 60 * 1000,
  demoAccounts = [],
  minPasswordLength = 8,
  secureCookies = process.env.NODE_ENV === 'production',
}) {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: use the real client IP
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // Defense in depth on top of server-side sanitization: even if markup
      // slipped through, no inline or third-party script could run.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'", // React style attributes (avatars) and the editor
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  // Request id (echoed to the client) + one access-log line per API request.
  app.use((req, res, next) => {
    // Accept an upstream id only if it is short and safe to log.
    const incoming = req.get('x-request-id');
    req.id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.id);
    if (logRequests && req.path.startsWith('/api/')) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        console.log(
          JSON.stringify({
            t: new Date().toISOString(),
            id: req.id,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Math.round(ms),
            user: req.user?.id,
          })
        );
      });
    }
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Brute-force protection: only failed logins count toward the limit.
  const login = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginAttemptsPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many failed sign-in attempts. Try again in a few minutes.' },
  });

  // File conversion is the most CPU-heavy endpoint; cap it per user.
  const upload = rateLimit({
    windowMs: 60 * 1000,
    limit: uploadsPerMinute,
    keyGenerator: (req) => req.user?.id || req.ip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many uploads in a short time. Please wait a minute and try again.' },
  });

  const signup = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: signupsPerHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this network. Try again later.' },
  });

  const limiters = { login, signup, upload };

  const options = { allowSignup, minPasswordLength, demoAccounts, maxUploadBytes, maxVersionsPerDoc };
  const session = createSession({ db, jwtSecret, sessionDays, secureCookies });
  const docs = createDocumentService({ db, versionSessionMs, maxVersionsPerDoc });
  const presence = createPresenceStore();
  app.locals.presence = presence; // exposed for tests
  const ctx = { db, docs, session, limiters, options, presence };

  // Order matters: specific paths (e.g. /documents/import) before /documents/:id.
  app.use('/api', systemRoutes(ctx));
  app.use('/api', authRoutes(ctx));
  app.use('/api', uploadRoutes(ctx));
  app.use('/api', documentRoutes(ctx));
  app.use('/api', sharingRoutes(ctx));
  app.use('/api', versionRoutes(ctx));
  app.use('/api', presenceRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- static client ----------
  if (clientDist && fs.existsSync(clientDist)) {
    // Vite fingerprints files in /assets, so they can be cached forever;
    // index.html must always be revalidated so users get new deploys.
    app.use(
      '/assets',
      express.static(path.join(clientDist, 'assets'), { immutable: true, maxAge: '1y', index: false })
    );
    app.use(express.static(clientDist, { index: false, maxAge: 0 }));
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof UnsupportedFileError) return res.status(415).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    const status = err.status || 500;
    if (status >= 500) console.error(JSON.stringify({ id: req.id, error: err.message, stack: err.stack }));
    res.status(status).json(
      status >= 500 ? { error: 'Something went wrong on our side', requestId: req.id } : { error: err.message }
    );
  });

  return app;
}
