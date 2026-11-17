// Storage adapter.
// - Production (DATABASE_URL set): Postgres via `pg`.
// - Local dev and tests: SQLite file via `better-sqlite3` (zero setup).
// All SQL in the app uses Postgres-style $1 placeholders and portable types
// (TEXT ids, ISO timestamps as TEXT) so the same statements run on both engines.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES users(id),
     title TEXT NOT NULL,
     content TEXT NOT NULL DEFAULT '',
     version INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS document_shares (
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id),
     role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
     created_at TEXT NOT NULL,
     PRIMARY KEY (document_id, user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS document_versions (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     content TEXT NOT NULL,
     author_id TEXT NOT NULL REFERENCES users(id),
     note TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id)`,
];

function createPg(url) {
  const { Pool } = require('pg');
  // SSL for public hosts (e.g. Render external URL, Neon); off for localhost and
  // private-network hostnames without a dot (e.g. Render's internal "dpg-xxx-a").
  const host = new URL(url).hostname;
  const useSsl =
    process.env.DATABASE_SSL !== undefined
      ? process.env.DATABASE_SSL === 'true'
      : host !== 'localhost' && host !== '127.0.0.1' && host.includes('.');
  const pool = new Pool({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });
  return {
    kind: 'postgres',
    async query(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows;
    },
    async close() {
      await pool.end();
    },
  };
}

function createSqlite(file) {
  const Database = require('better-sqlite3');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return {
    kind: 'sqlite',
    async query(sql, params = []) {
      // Rewrite $1..$n to positional ? and reorder params to match
      // (handles a placeholder used more than once, e.g. $5 twice).
      const ordered = [];
      const stmt = db.prepare(
        sql.replace(/\$(\d+)/g, (_m, n) => {
          ordered.push(params[Number(n) - 1]);
          return '?';
        })
      );
      return stmt.reader ? stmt.all(...ordered) : (stmt.run(...ordered), []);
    },
    async close() {
      db.close();
    },
  };
}

export async function createDb({ databaseUrl, sqliteFile } = {}) {
  const db = databaseUrl
    ? createPg(databaseUrl)
    : createSqlite(sqliteFile || path.resolve('data', 'ajaia.db'));
  for (const stmt of SCHEMA) await db.query(stmt);
  await runMigrations(db);
  return db;
}

// Additive migrations for databases created by earlier versions of the app.
// Each step is idempotent: "already exists" errors are expected and ignored.
const MIGRATIONS = [
  'ALTER TABLE documents ADD COLUMN updated_by TEXT REFERENCES users(id)',
];

async function runMigrations(db) {
  for (const stmt of MIGRATIONS) {
    try {
      await db.query(stmt);
    } catch (err) {
      if (!/duplicate column|already exists/i.test(err.message)) throw err;
    }
  }
}
