// Sign-in, sign-up, session and the share-dialog user directory.
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { HttpError, h } from '../http.js';
import { GETTING_STARTED_HTML } from '../templates.js';

// Compared against when an email is unknown, so a failed login takes the same
// time whether or not the account exists (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authRoutes({ db, docs, session, limiters, options }) {
  const { allowSignup, minPasswordLength, demoAccounts } = options;
  const { requireUser, startSession, clearSession } = session;
  const { insertDoc } = docs;
  const router = express.Router();

  router.post(
    '/auth/login',
    limiters.login,
    h(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) throw new HttpError(400, 'Email and password are required');
      const [user] = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !valid) {
        throw new HttpError(401, 'Invalid email or password');
      }
      startSession(res, user.id);
      res.json({ user: { id: user.id, email: user.email, name: user.name } });
    })
  );

  router.post(
    '/auth/signup',
    limiters.signup,
    h(async (req, res) => {
      if (!allowSignup) throw new HttpError(403, 'Sign-up is disabled on this server');
      const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!name || name.length > 80) throw new HttpError(400, 'Please enter your name (up to 80 characters)');
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Please enter a valid email address');
      if (password.length < minPasswordLength) throw new HttpError(400, `Password must be at least ${minPasswordLength} characters`);
      if (password.length > 200) throw new HttpError(400, 'Password is too long');

      const [existing] = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
      const id = randomUUID();
      const hash = await bcrypt.hash(password, 10);
      try {
        await db.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, email, name, hash]);
      } catch (err) {
        // Two sign-ups for the same email at the same moment: the UNIQUE constraint decides.
        if (/unique|duplicate/i.test(err.message)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
        throw err;
      }
      // Every new account starts with a short guide instead of an empty screen.
      await insertDoc(id, 'Getting started', GETTING_STARTED_HTML, 'Created');
      startSession(res, id);
      res.status(201).json({ user: { id, email, name } });
    })
  );

  router.post('/auth/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireUser, (req, res) => res.json({ user: req.user }));

  router.get(
    '/users',
    requireUser,
    h(async (req, res) => {
      // Suggestions for the share dialog: only people you already collaborate
      // with. Listing every account would expose the whole user base (names and
      // emails) to anyone who signs up.
      const users = await db.query(
        `SELECT id, email, name FROM users
          WHERE id <> $1 AND id IN (
            SELECT s.user_id FROM document_shares s JOIN documents d ON d.id = s.document_id WHERE d.owner_id = $1
            UNION SELECT d.owner_id FROM document_shares s JOIN documents d ON d.id = s.document_id WHERE s.user_id = $1
            UNION SELECT s2.user_id FROM document_shares s
                    JOIN document_shares s2 ON s2.document_id = s.document_id WHERE s.user_id = $1
          )
          ORDER BY name`,
        [req.user.id]
      );
      // Demo accounts are already listed publicly on the sign-in page, so in demo
      // mode they are offered too; real accounts never are.
      const known = new Set(users.map((u) => u.email));
      const demoUsers = demoAccounts.length
        ? await db.query(
            `SELECT id, email, name FROM users WHERE id <> $1 AND email IN (${demoAccounts.map((_, i) => `$${i + 2}`).join(', ')})`,
            [req.user.id, ...demoAccounts.map((d) => d.email)]
          )
        : [];
      res.json({ users: [...users, ...demoUsers.filter((u) => !known.has(u.email))] });
    })
  );

  return router;
}
