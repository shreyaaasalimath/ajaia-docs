import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  sanitizeContent,
  fileToHtml,
  UnsupportedFileError,
  MAX_UPLOAD_BYTES,
  SUPPORTED_EXTENSIONS,
} from './content.js';

const COOKIE = 'ajaia_session';
const MAX_TITLE = 200;
const MAX_CONTENT_CHARS = 1_000_000;
// Autosaves by the same person within this window are folded into one history
// entry (like an "editing session"), so history stays readable.
const VERSION_SESSION_MS = 5 * 60 * 1000;
const PRESENCE_TTL_MS = 25 * 1000;
// Compared against when an email is unknown, so a failed login takes the same
// time whether or not the account exists (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);
const REQUEST_ID_RE = /^[\w-]{1,64}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async handlers so thrown errors reach the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp({ db, jwtSecret, clientDist, loginAttemptsPerWindow = 10, logRequests = false }) {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: use the real client IP
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
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
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginAttemptsPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many failed sign-in attempts. Try again in a few minutes.' },
  });

  // File conversion is the most CPU-heavy endpoint; cap it per user.
  const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    keyGenerator: (req) => req.user?.id || req.ip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many uploads in a short time. Please wait a minute and try again.' },
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // ---------- auth ----------
  const requireUser = h(async (req, _res, next) => {
    const token = req.cookies[COOKIE];
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const [user] = await db.query('SELECT id, email, name FROM users WHERE id = $1', [payload.sub]);
    if (!user) throw new HttpError(401, 'Not signed in');
    req.user = user;
    next();
  });

  app.post(
    '/api/auth/login',
    loginLimiter,
    h(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) throw new HttpError(400, 'Email and password are required');
      const [user] = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !valid) {
        throw new HttpError(401, 'Invalid email or password');
      }
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' });
      res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 3600 * 1000,
      });
      res.json({ user: { id: user.id, email: user.email, name: user.name } });
    })
  );

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: req.user }));

  app.get(
    '/api/users',
    requireUser,
    h(async (req, res) => {
      // Small directory so the share dialog can suggest teammates.
      const users = await db.query('SELECT id, email, name FROM users WHERE id <> $1 ORDER BY name', [
        req.user.id,
      ]);
      res.json({ users });
    })
  );

  // ---------- access control ----------
  /** Returns { doc, role } where role is 'owner' | 'editor' | 'viewer', or throws 404. */
  async function loadDocWithRole(docId, userId) {
    const [doc] = await db.query('SELECT * FROM documents WHERE id = $1', [docId]);
    if (doc) {
      if (doc.owner_id === userId) return { doc, role: 'owner' };
      const [share] = await db.query(
        'SELECT role FROM document_shares WHERE document_id = $1 AND user_id = $2',
        [docId, userId]
      );
      if (share) return { doc, role: share.role };
    }
    // Same response for "missing" and "no access" so document ids do not leak.
    throw new HttpError(404, 'Document not found');
  }

  const canEdit = (role) => role === 'owner' || role === 'editor';

  async function sharesFor(docId) {
    return db.query(
      `SELECT u.id AS user_id, u.email, u.name, s.role
         FROM document_shares s JOIN users u ON u.id = s.user_id
        WHERE s.document_id = $1 ORDER BY u.name`,
      [docId]
    );
  }

  async function serializeDoc(doc, role) {
    const [owner] = await db.query('SELECT id, email, name FROM users WHERE id = $1', [doc.owner_id]);
    const [editor] = doc.updated_by
      ? await db.query('SELECT id, name FROM users WHERE id = $1', [doc.updated_by])
      : [];
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: Number(doc.version),
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      updatedBy: editor || null,
      owner,
      role,
      shares: role === 'owner' ? await sharesFor(doc.id) : undefined,
    };
  }

  function cleanTitle(raw) {
    const title = String(raw ?? '').trim();
    if (!title) throw new HttpError(400, 'Title cannot be empty');
    if (title.length > MAX_TITLE) throw new HttpError(400, `Title must be at most ${MAX_TITLE} characters`);
    return title;
  }

  async function insertDoc(ownerId, title, html, note = 'Created') {
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.query(
      `INSERT INTO documents (id, owner_id, title, content, version, created_at, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, 1, $5, $5, $2)`,
      [id, ownerId, title, sanitizeContent(html), now]
    );
    const [doc] = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
    await recordVersion(doc, ownerId, { note, forceNew: true });
    return doc;
  }

  // ---------- version history ----------
  /**
   * Documents created before version history existed have no snapshots. Before
   * their first change, store the current state as a baseline so the original
   * content can always be restored.
   */
  async function ensureBaseline(doc) {
    const [any] = await db.query('SELECT id FROM document_versions WHERE document_id = $1 LIMIT 1', [doc.id]);
    if (any) return;
    await db.query(
      `INSERT INTO document_versions (id, document_id, title, content, author_id, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Original version', $6, $6)`,
      [randomUUID(), doc.id, doc.title, doc.content, doc.updated_by || doc.owner_id, doc.updated_at]
    );
  }

  /**
   * Snapshot the document's current state. Consecutive saves by the same
   * author within VERSION_SESSION_MS update the latest snapshot instead of
   * adding a new one. Milestones (entries with a note: Created, Imported,
   * Restored) are never modified, so they can always be restored exactly.
   */
  async function recordVersion(doc, authorId, { note = null, forceNew = false } = {}) {
    const now = new Date().toISOString();
    if (!forceNew) {
      const [latest] = await db.query(
        `SELECT id, author_id, created_at, note FROM document_versions
          WHERE document_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [doc.id]
      );
      const fresh = latest && Date.now() - new Date(latest.created_at).getTime() < VERSION_SESSION_MS;
      if (fresh && latest.author_id === authorId && !latest.note) {
        await db.query(
          'UPDATE document_versions SET title = $1, content = $2, updated_at = $3 WHERE id = $4',
          [doc.title, doc.content, now, latest.id]
        );
        return;
      }
    }
    await db.query(
      `INSERT INTO document_versions (id, document_id, title, content, author_id, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [randomUUID(), doc.id, doc.title, doc.content, authorId, note, now]
    );
  }

  // ---------- documents ----------
  app.get(
    '/api/documents',
    requireUser,
    h(async (req, res) => {
      const owned = await db.query(
        `SELECT id, title, updated_at FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC`,
        [req.user.id]
      );
      const shared = await db.query(
        `SELECT d.id, d.title, d.updated_at, s.role, u.name AS owner_name, u.email AS owner_email
           FROM document_shares s
           JOIN documents d ON d.id = s.document_id
           JOIN users u ON u.id = d.owner_id
          WHERE s.user_id = $1
          ORDER BY d.updated_at DESC`,
        [req.user.id]
      );
      res.json({
        owned: owned.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updated_at, role: 'owner' })),
        shared: shared.map((d) => ({
          id: d.id,
          title: d.title,
          updatedAt: d.updated_at,
          role: d.role,
          owner: { name: d.owner_name, email: d.owner_email },
        })),
      });
    })
  );

  app.post(
    '/api/documents',
    requireUser,
    h(async (req, res) => {
      const title = req.body?.title === undefined ? 'Untitled document' : cleanTitle(req.body.title);
      const doc = await insertDoc(req.user.id, title, req.body?.content || '');
      res.status(201).json({ document: await serializeDoc(doc, 'owner') });
    })
  );

  app.get(
    '/api/documents/:id',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      res.json({ document: await serializeDoc(doc, role) });
    })
  );

  // Rename and/or save content. Uses optimistic concurrency: the client sends the
  // version it last loaded; a stale version gets 409 instead of silently
  // overwriting a collaborator's edits.
  app.patch(
    '/api/documents/:id',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (!canEdit(role)) throw new HttpError(403, 'You have view-only access to this document');

      const body = req.body || {};
      if (body.title === undefined && body.content === undefined) {
        throw new HttpError(400, 'Nothing to update');
      }
      const version = Number(body.version);
      if (!Number.isInteger(version)) throw new HttpError(400, 'version is required');
      if (version !== Number(doc.version)) {
        throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.');
      }

      const title = body.title === undefined ? doc.title : cleanTitle(body.title);
      let content = doc.content;
      if (body.content !== undefined) {
        if (typeof body.content !== 'string') throw new HttpError(400, 'content must be a string');
        if (body.content.length > MAX_CONTENT_CHARS) throw new HttpError(413, 'Document is too large');
        content = sanitizeContent(body.content);
      }

      await ensureBaseline(doc);
      const now = new Date().toISOString();
      const updated = await db.query(
        `UPDATE documents SET title = $1, content = $2, version = version + 1, updated_at = $3, updated_by = $6
          WHERE id = $4 AND version = $5 RETURNING *`,
        [title, content, now, doc.id, version, req.user.id]
      );
      if (!updated.length) {
        throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.');
      }
      await recordVersion(updated[0], req.user.id);
      res.json({ document: await serializeDoc(updated[0], role) });
    })
  );

  app.delete(
    '/api/documents/:id',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can delete this document');
      // One statement: shares and versions go with it via ON DELETE CASCADE,
      // so a failure part-way can never leave orphaned rows behind.
      await db.query('DELETE FROM documents WHERE id = $1', [doc.id]);
      presence.delete(doc.id);
      res.status(204).end();
    })
  );

  // Anyone who can open a document can make their own copy of it.
  app.post(
    '/api/documents/:id/copy',
    requireUser,
    h(async (req, res) => {
      const { doc } = await loadDocWithRole(req.params.id, req.user.id);
      const title = `Copy of ${doc.title}`.slice(0, MAX_TITLE);
      const copy = await insertDoc(req.user.id, title, doc.content, `Copied from "${doc.title}"`.slice(0, 200));
      res.status(201).json({ document: await serializeDoc(copy, 'owner') });
    })
  );

  // ---------- sharing ----------
  app.post(
    '/api/documents/:id/shares',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can share this document');

      const email = String(req.body?.email || '').trim().toLowerCase();
      const shareRole = req.body?.role || 'editor';
      if (!email) throw new HttpError(400, 'Email is required');
      if (!['viewer', 'editor'].includes(shareRole)) throw new HttpError(400, 'Role must be viewer or editor');

      const [target] = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (!target) throw new HttpError(404, `No user with email ${email}`);
      if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document');

      const now = new Date().toISOString();
      // Upsert so re-sharing changes the role instead of failing.
      await db.query(
        `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
        [doc.id, target.id, shareRole, now]
      );
      res.status(201).json({ shares: await sharesFor(doc.id) });
    })
  );

  app.delete(
    '/api/documents/:id/shares/:userId',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can change sharing');
      await db.query('DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2', [
        doc.id,
        req.params.userId,
      ]);
      res.json({ shares: await sharesFor(doc.id) });
    })
  );

  // ---------- file upload ----------
  const singleFile = (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'File is larger than 2 MB'));
      if (err) return next(new HttpError(400, err.message));
      if (!req.file) return next(new HttpError(400, 'No file uploaded (field name must be "file")'));
      next();
    });

  // Upload a file -> brand new document owned by the uploader.
  app.post(
    '/api/documents/import',
    requireUser,
    uploadLimiter,
    singleFile,
    h(async (req, res) => {
      const { title, html } = await fileToHtml(req.file.originalname, req.file.buffer);
      const doc = await insertDoc(req.user.id, title, html, `Imported from ${req.file.originalname}`.slice(0, 200));
      res.status(201).json({ document: await serializeDoc(doc, 'owner') });
    })
  );

  // Upload a file -> sanitized HTML the client inserts into the open draft.
  app.post(
    '/api/convert',
    requireUser,
    uploadLimiter,
    singleFile,
    h(async (req, res) => {
      const { html } = await fileToHtml(req.file.originalname, req.file.buffer);
      res.json({ html });
    })
  );

  // ---------- version history routes ----------
  const requireEditAccess = async (req) => {
    const ctx = await loadDocWithRole(req.params.id, req.user.id);
    if (!canEdit(ctx.role)) throw new HttpError(403, 'Version history is available to owners and editors');
    return ctx;
  };

  app.get(
    '/api/documents/:id/versions',
    requireUser,
    h(async (req, res) => {
      const { doc } = await requireEditAccess(req);
      const rows = await db.query(
        `SELECT v.id, v.title, v.note, v.created_at, v.updated_at, u.name AS author_name
           FROM document_versions v JOIN users u ON u.id = v.author_id
          WHERE v.document_id = $1 ORDER BY v.updated_at DESC LIMIT 100`,
        [doc.id]
      );
      res.json({
        versions: rows.map((v, i) => ({
          id: v.id,
          title: v.title,
          note: v.note,
          author: v.author_name,
          startedAt: v.created_at,
          savedAt: v.updated_at,
          current: i === 0,
        })),
      });
    })
  );

  app.get(
    '/api/documents/:id/versions/:versionId',
    requireUser,
    h(async (req, res) => {
      const { doc } = await requireEditAccess(req);
      const [v] = await db.query(
        'SELECT id, title, content, updated_at FROM document_versions WHERE id = $1 AND document_id = $2',
        [req.params.versionId, doc.id]
      );
      if (!v) throw new HttpError(404, 'Version not found');
      res.json({ version: { id: v.id, title: v.title, content: v.content, savedAt: v.updated_at } });
    })
  );

  app.post(
    '/api/documents/:id/versions/:versionId/restore',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await requireEditAccess(req);
      const [v] = await db.query(
        'SELECT title, content, updated_at FROM document_versions WHERE id = $1 AND document_id = $2',
        [req.params.versionId, doc.id]
      );
      if (!v) throw new HttpError(404, 'Version not found');
      const now = new Date().toISOString();
      const [updated] = await db.query(
        `UPDATE documents SET title = $1, content = $2, version = version + 1, updated_at = $3, updated_by = $4
          WHERE id = $5 RETURNING *`,
        [v.title, v.content, now, req.user.id, doc.id]
      );
      const when = new Date(v.updated_at).toISOString().slice(0, 16).replace('T', ' ');
      await recordVersion(updated, req.user.id, { note: `Restored version from ${when} UTC`, forceNew: true });
      res.json({ document: await serializeDoc(updated, role) });
    })
  );

  // ---------- presence ----------
  // In-memory, per process: who has each document open right now. Clients send
  // a heartbeat every few seconds; entries expire after PRESENCE_TTL_MS. The
  // response also carries the document's current version so clients can pull
  // in a collaborator's saved changes without a manual reload.
  const presence = new Map(); // docId -> Map(userId -> { name, email, editing, seenAt })
  // Sweep stale entries so documents nobody has open do not accumulate in memory
  // (tabs that close without saying goodbye never call DELETE).
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [docId, here] of presence) {
      for (const [uid, p] of here) if (now - p.seenAt > PRESENCE_TTL_MS) here.delete(uid);
      if (!here.size) presence.delete(docId);
    }
  }, 60_000);
  sweep.unref();
  app.locals.presence = presence; // exposed for tests

  app.post(
    '/api/documents/:id/presence',
    requireUser,
    h(async (req, res) => {
      const { doc } = await loadDocWithRole(req.params.id, req.user.id);
      const now = Date.now();
      const here = presence.get(doc.id) || new Map();
      presence.set(doc.id, here);
      here.set(req.user.id, {
        name: req.user.name,
        email: req.user.email,
        editing: Boolean(req.body?.editing),
        seenAt: now,
      });
      for (const [uid, p] of here) if (now - p.seenAt > PRESENCE_TTL_MS) here.delete(uid);
      const [editor] = doc.updated_by
        ? await db.query('SELECT id, name FROM users WHERE id = $1', [doc.updated_by])
        : [];
      res.json({
        viewers: [...here.entries()]
          .filter(([uid]) => uid !== req.user.id)
          .map(([id, p]) => ({ id, name: p.name, email: p.email, editing: p.editing })),
        version: Number(doc.version),
        updatedAt: doc.updated_at,
        updatedBy: editor || null,
      });
    })
  );

  app.delete(
    '/api/documents/:id/presence',
    requireUser,
    (req, res) => {
      const here = presence.get(req.params.id);
      here?.delete(req.user.id);
      if (here && !here.size) presence.delete(req.params.id);
      res.status(204).end();
    }
  );

  // Used by Render's health check: verifies the database, not just the process.
  app.get(
    '/api/health',
    h(async (_req, res) => {
      const started = Date.now();
      try {
        await db.query('SELECT 1 AS ok');
        res.json({ ok: true, db: db.kind, dbLatencyMs: Date.now() - started, uptimeS: Math.round(process.uptime()) });
      } catch {
        res.status(503).json({ ok: false, db: db.kind, error: 'Database unavailable' });
      }
    })
  );
  app.get('/api/config', (_req, res) =>
    res.json({ supportedExtensions: SUPPORTED_EXTENSIONS, maxUploadBytes: MAX_UPLOAD_BYTES })
  );

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
