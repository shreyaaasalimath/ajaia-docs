// Document domain logic shared by the route modules: access control,
// serialization, creation and version snapshots. Routes stay thin.
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { sanitizeContent } from '../content.js';

export const MAX_TITLE = 200;
export const canEdit = (role) => role === 'owner' || role === 'editor';

export function createDocumentService({ db, versionSessionMs, maxVersionsPerDoc }) {
  // Access control
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

  // Version history
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
   * author within versionSessionMs update the latest snapshot instead of
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
      const fresh = latest && Date.now() - new Date(latest.created_at).getTime() < versionSessionMs;
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
    // Retention: snapshots are full copies, so cap how many a document keeps.
    // Milestones (Created / Imported / Restored / Original) are always kept.
    await db.query(
      `DELETE FROM document_versions
        WHERE document_id = $1 AND note IS NULL
          AND id NOT IN (SELECT id FROM document_versions WHERE document_id = $1
                          ORDER BY updated_at DESC LIMIT $2)`,
      [doc.id, maxVersionsPerDoc]
    );
  }

  return { loadDocWithRole, sharesFor, serializeDoc, cleanTitle, insertDoc, ensureBaseline, recordVersion };
}
