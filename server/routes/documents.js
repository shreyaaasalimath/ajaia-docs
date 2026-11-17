// Document CRUD: list, create, open, save (with optimistic concurrency), delete, copy.
import express from 'express';
import { HttpError, h } from '../http.js';
import { sanitizeContent } from '../content.js';
import { canEdit, MAX_TITLE } from '../services/documents.js';

const MAX_CONTENT_CHARS = 1_000_000;

export function documentRoutes({ db, docs, session, presence }) {
  const { requireUser } = session;
  const { loadDocWithRole, serializeDoc, cleanTitle, insertDoc, ensureBaseline, recordVersion } = docs;
  const router = express.Router();

  router.get(
    '/documents',
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

  router.post(
    '/documents',
    requireUser,
    h(async (req, res) => {
      const title = req.body?.title === undefined ? 'Untitled document' : cleanTitle(req.body.title);
      const doc = await insertDoc(req.user.id, title, req.body?.content || '');
      res.status(201).json({ document: await serializeDoc(doc, 'owner') });
    })
  );

  router.get(
    '/documents/:id',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      res.json({ document: await serializeDoc(doc, role) });
    })
  );

  // Rename and/or save content. Uses optimistic concurrency: the client sends the
  // version it last loaded; a stale version gets 409 instead of silently
  // overwriting a collaborator's edits.
  router.patch(
    '/documents/:id',
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

  router.delete(
    '/documents/:id',
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
  router.post(
    '/documents/:id/copy',
    requireUser,
    h(async (req, res) => {
      const { doc } = await loadDocWithRole(req.params.id, req.user.id);
      const title = `Copy of ${doc.title}`.slice(0, MAX_TITLE);
      const copy = await insertDoc(req.user.id, title, doc.content, `Copied from "${doc.title}"`.slice(0, 200));
      res.status(201).json({ document: await serializeDoc(copy, 'owner') });
    })
  );

  return router;
}
