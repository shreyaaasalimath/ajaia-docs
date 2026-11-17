// Version history: list snapshots, preview one, restore it (restores are undoable).
import express from 'express';
import { HttpError, h } from '../http.js';
import { canEdit } from '../services/documents.js';

// How many entries the History panel lists. Separate from retention
// (MAX_VERSIONS_PER_DOC), which never removes milestones, so there can be more.
const HISTORY_LIST_LIMIT = 200;

export function versionRoutes({ db, docs, session }) {
  const { requireUser } = session;
  const { loadDocWithRole, serializeDoc, recordVersion } = docs;
  const router = express.Router();

  const requireEditAccess = async (req) => {
    const ctx = await loadDocWithRole(req.params.id, req.user.id);
    if (!canEdit(ctx.role)) throw new HttpError(403, 'Version history is available to owners and editors');
    return ctx;
  };

  router.get(
    '/documents/:id/versions',
    requireUser,
    h(async (req, res) => {
      const { doc } = await requireEditAccess(req);
      const rows = await db.query(
        `SELECT v.id, v.title, v.note, v.created_at, v.updated_at, u.name AS author_name
           FROM document_versions v JOIN users u ON u.id = v.author_id
          WHERE v.document_id = $1 ORDER BY v.updated_at DESC LIMIT $2`,
        [doc.id, HISTORY_LIST_LIMIT]
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

  router.get(
    '/documents/:id/versions/:versionId',
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

  router.post(
    '/documents/:id/versions/:versionId/restore',
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

  return router;
}
