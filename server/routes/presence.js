// Presence: who has a document open right now, plus the latest saved version so
// clients can pull in collaborators' changes. In memory, per process.
import express from 'express';
import { h } from '../http.js';

const PRESENCE_TTL_MS = 25 * 1000;

export function createPresenceStore() {
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
  return presence;
}

export function presenceRoutes({ db, docs, session, presence }) {
  const { requireUser } = session;
  const { loadDocWithRole } = docs;
  const router = express.Router();

  router.post(
    '/documents/:id/presence',
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

  router.delete(
    '/documents/:id/presence',
    requireUser,
    (req, res) => {
      const here = presence.get(req.params.id);
      here?.delete(req.user.id);
      if (here && !here.size) presence.delete(req.params.id);
      res.status(204).end();
    }
  );

  return router;
}
