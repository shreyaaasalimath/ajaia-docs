# Ajaia Docs

A lightweight collaborative document editor: create and edit rich-text documents, import files, and share documents with teammates as editors or viewers.

**Live app:** `<LIVE_URL>`
**Demo accounts** (password for all: `password123`):

| Account | Role in the seeded data |
|---|---|
| `alice@ajaia.test` | Owns "Welcome to Ajaia Docs" |
| `bob@ajaia.test` | Has "Welcome to Ajaia Docs" shared with him as an **editor** |
| `carol@ajaia.test` | No access to anything yet (useful for testing sharing from scratch) |

The login page has one-click buttons for each account.

> Note: the live app runs on Render's free tier. If it has been idle, the first request can take about 30–50 seconds while the server wakes up.

## Features

| Area | What works |
|---|---|
| Documents | Create, rename (click the title), edit, delete (owner only), reopen from the sidebar |
| Rich text | Bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quote, code block, divider, undo/redo, keyboard shortcuts |
| Saving | Autosave about 0.8 s after you stop typing, a visible save status, Ctrl/Cmd+S to save now, a warning before closing with unsaved changes |
| File upload | **Import file** (sidebar) turns a `.txt`, `.md` or `.docx` file into a new document. **⋯ → Insert from file** adds a file's content into the open document. Maximum 2 MB. |
| Sharing | Owner shares by email as **Can edit** or **Can view**, can change roles and remove access. The sidebar separates **My documents** from **Shared with me**. Viewers get a read-only editor. |
| Persistence | Postgres in production, SQLite locally. Formatting is stored as sanitized HTML. |
| Export (stretch) | Download as Markdown or HTML, Print / Save as PDF |
| Safety | Server-side HTML sanitization, conflict detection (409) instead of silent overwrites, uniform 404 for documents you cannot access |

**Supported upload types:** `.txt`, `.md`, `.docx` only (max 2 MB). Other types are rejected with a clear message in both the UI and the API.

## Run locally

Requirements: Node.js 20+ (tested on 22).

```bash
npm install
npm run build      # builds the React client into client/dist
npm start          # http://localhost:3001  (API + client, SQLite at ./data/ajaia.db)
```

For development with hot reload (Vite on :5173 proxying the API on :3001):

```bash
npm run dev
```

No database setup is needed locally. With no `DATABASE_URL` set, the server creates a SQLite file and seeds the demo users on first start. Seeding is idempotent.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | unset → SQLite | Postgres connection string (production) |
| `SQLITE_FILE` | `./data/ajaia.db` | SQLite path when `DATABASE_URL` is unset |
| `JWT_SECRET` | dev default | Secret for signing session cookies. **Set this in production.** |
| `DATABASE_SSL` | auto | Force Postgres SSL on (`true`) or off (`false`) |

## Tests

```bash
npm test
```

This runs 7 API integration tests (Node's built-in test runner + supertest) against an in-memory SQLite database. They cover:

- authentication (unauthenticated requests and wrong passwords are rejected)
- create, rename, save and reopen with formatting preserved
- sharing rules: a viewer can read but not edit, an editor can edit but not reshare or delete, strangers get 404, revoking removes access
- stale saves get 409 and never overwrite newer content
- XSS sanitization of stored content
- `.md` / `.txt` import, plus rejection of unsupported or missing files
- validation of titles, roles and unknown users

I also ran the same suite against Postgres 16 to confirm the SQL works on both engines.

**Browser smoke test** (optional, Playwright, needs a fresh database): `python e2e/smoke_test.py` while the app is running. It covers the full UI flow, including switching documents right after typing.

## Deploy (Render, free)

The repo includes a `render.yaml` Blueprint with one free web service and one free Postgres database.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** and select the repo, then **Apply**.
3. Render creates the database, generates `JWT_SECRET`, runs `npm ci && npm run build`, and starts `npm start`. The demo users are seeded automatically on first boot.

## Project structure

```
server/
  index.js        boot: DB, seed, start HTTP server
  app.js          Express app: auth, documents, sharing, upload, errors
  db.js           storage adapter (Postgres or SQLite, same SQL)
  content.js      HTML sanitization + .txt/.md/.docx → HTML conversion
  seed.js         demo users and the welcome document
  test/           API integration tests
client/src/
  App.jsx         layout, sidebar (owned vs shared), routing, import
  DocumentEditor.jsx  TipTap editor, autosave, conflicts, export
  Toolbar.jsx     formatting toolbar
  SharePanel.jsx  share, change role, revoke
  Login.jsx       login with demo accounts
e2e/smoke_test.py browser smoke test
docs/screenshots/ screenshots of the main flows
```

See `ARCHITECTURE.md` for design decisions and `AI_WORKFLOW.md` for how I used AI tools.
