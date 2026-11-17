import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

// Used only by tests and local development; deployments pass DEMO_PASSWORD via config.
export const DEFAULT_DEMO_PASSWORD = 'password123';

// Demo data for reviewers (disable with SEED_DEMO_DATA=false). `hint` is shown
// on the sign-in page via /api/config, so the client holds no account list.
export const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Owner', hint: 'owns the welcome doc' },
  { email: 'bob@ajaia.test', name: 'Bob Teammate', hint: 'has the welcome doc shared' },
  { email: 'carol@ajaia.test', name: 'Carol Reviewer', hint: 'no access yet' },
];

/** Public description of the demo accounts for the sign-in page. */
export const demoAccounts = (password = DEFAULT_DEMO_PASSWORD) =>
  DEMO_USERS.map(({ email, name, hint }) => ({ email, name, hint, password }));

const WELCOME_HTML = `<h1>Welcome to Ajaia Docs</h1>
<p>This document is owned by <strong>Alice</strong> and shared with <em>Bob</em> as an <u>editor</u>.</p>
<h2>Try it out</h2>
<ul><li>Format text with the toolbar or keyboard shortcuts (Ctrl/Cmd + B, I, U)</li><li>Import a .txt, .md or .docx file</li><li>Share a document with another seeded user</li></ul>
<ol><li>Log in as Alice and edit this doc</li><li>Log out, log in as Bob, and see it under "Shared with me"</li><li>Open the same doc as Alice and Bob in two browsers to see live presence and changes appear</li><li>Open <strong>History</strong> to preview and restore earlier versions</li></ol>`;

// Idempotent: safe to run on every boot.
export async function seed(db, { password = DEFAULT_DEMO_PASSWORD } = {}) {
  const hash = bcrypt.hashSync(password, 10);
  const ids = {};
  for (const u of DEMO_USERS) {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [u.email]);
    if (existing.length) {
      ids[u.email] = existing[0].id;
      continue;
    }
    const id = randomUUID();
    await db.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [
      id,
      u.email,
      u.name,
      hash,
    ]);
    ids[u.email] = id;
  }

  const alice = ids['alice@ajaia.test'];
  const owned = await db.query('SELECT id FROM documents WHERE owner_id = $1 LIMIT 1', [alice]);
  if (!owned.length) {
    const now = new Date().toISOString();
    const docId = randomUUID();
    await db.query(
      `INSERT INTO documents (id, owner_id, title, content, version, created_at, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, 1, $5, $5, $2)`,
      [docId, alice, 'Welcome to Ajaia Docs', WELCOME_HTML, now]
    );
    await db.query(
      `INSERT INTO document_versions (id, document_id, title, content, author_id, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Created', $6, $6)`,
      [randomUUID(), docId, 'Welcome to Ajaia Docs', WELCOME_HTML, alice, now]
    );
    await db.query(
      `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES ($1, $2, 'editor', $3)`,
      [docId, ids['bob@ajaia.test'], now]
    );
  }
}
