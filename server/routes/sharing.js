// Sharing: owners grant, change and revoke per-user access (editor / viewer).
import express from 'express';
import { HttpError, h } from '../http.js';

export function sharingRoutes({ db, docs, session }) {
  const { requireUser } = session;
  const { loadDocWithRole, sharesFor } = docs;
  const router = express.Router();

  router.post(
    '/documents/:id/shares',
    requireUser,
    h(async (req, res) => {
      const { doc, role } = await loadDocWithRole(req.params.id, req.user.id);
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can share this document');

      const email = String(req.body?.email || '').trim().toLowerCase();
      const shareRole = req.body?.role || 'editor';
      if (!email) throw new HttpError(400, 'Email is required');
      if (!['viewer', 'editor'].includes(shareRole)) throw new HttpError(400, 'Role must be viewer or editor');

      const [target] = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (!target) throw new HttpError(404, `No account found for ${email}. Ask them to sign up first, then share again.`);
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

  router.delete(
    '/documents/:id/shares/:userId',
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

  return router;
}
