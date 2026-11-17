import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async handlers so thrown errors reach the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp({ db, jwtSecret, clientDist }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

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
    h(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) throw new HttpError(400, 'Email and password are required');
      const [user] = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
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
    res.clearCookie(COOKIE);
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
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: Number(doc.version),
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
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

  async function insertDoc(ownerId, title, html) {
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.query(
      `INSERT INTO documents (id, owner_id, title, content, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)`,
      [id, ownerId, title, sanitizeContent(html), now]
    );
    const [doc] = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
    return doc;
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

      const now = new Date().toISOString();
      const updated = await db.query(
        `UPDATE documents SET title = $1, content = $2, version = version + 1, updated_at = $3
          WHERE id = $4 AND version = $5 RETURNING *`,
        [title, content, now, doc.id, version]
      );
      if (!updated.length) {
        throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.');
      }
      res.json({ document: await serializeDoc(updated[0], role) });
    })
  );

  app.delete(
    '/api/documents/:id',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can delete this document');
      await db.query('DELETE FROM document_shares WHERE document_id = $1', [doc.id]);
      await db.query('DELETE FROM documents WHERE id = $1', [doc.id]);
      res.status(204).end();
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
    singleFile,
    h(async (req, res) => {
      const { title, html } = await fileToHtml(req.file.originalname, req.file.buffer);
      const doc = await insertDoc(req.user.id, title, html);
      res.status(201).json({ document: await serializeDoc(doc, 'owner') });
    })
  );

  // Upload a file -> sanitized HTML the client inserts into the open draft.
  app.post(
    '/api/convert',
    requireUser,
    singleFile,
    h(async (req, res) => {
      const { html } = await fileToHtml(req.file.originalname, req.file.buffer);
      res.json({ html });
    })
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: db.kind }));
  app.get('/api/config', (_req, res) =>
    res.json({ supportedExtensions: SUPPORTED_EXTENSIONS, maxUploadBytes: MAX_UPLOAD_BYTES })
  );

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- static client ----------
  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof UnsupportedFileError) return res.status(415).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
  });

  return app;
}
