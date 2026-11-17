# Ajaia Docs

[![CI](https://github.com/shreyaaasalimath/ajaia-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/shreyaaasalimath/ajaia-docs/actions/workflows/ci.yml)

A lightweight collaborative document editor: create and edit rich-text documents, import files, share with teammates as editors or viewers, see who else is in a document, receive their changes live, and roll back to any earlier version.

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
| Documents | Create, rename (click the title), edit, delete (owner only), **make a copy** (any collaborator gets their own copy), reopen from the sidebar or the recent-documents grid |
| Rich text | Bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quote, code block, divider, undo/redo, keyboard shortcuts |
| Saving | Autosave about 0.8 s after you stop typing, a visible save status, Ctrl/Cmd+S to save now, a warning before closing with unsaved changes. If the network or server drops, edits stay in the tab and are **retried automatically** (with backoff, and immediately when the browser comes back online). |
| File upload | **Import file** (sidebar) turns a `.txt`, `.md` or `.docx` file into a new document. **⋯ → Insert from file** adds a file's content into the open document. Maximum 2 MB. |
| Sharing | Owner shares by email as **Can edit** or **Can view**, can change roles and remove access. The sidebar separates **My documents** from **Shared with me**. Viewers get a read-only editor. |
| Persistence | Postgres in production, SQLite locally. Formatting is stored as sanitized HTML. |
| **Version history** | **History** panel lists snapshots (who and when), previews any version read-only, and restores it in one click. Restores are themselves versions, so they can be undone. Autosaves by the same person within 5 minutes are grouped into one entry. |
| **Live presence** | Avatars show who else has the document open (a green ring means they are typing). When a collaborator saves, your view updates automatically **without moving your cursor**. If you have unsaved edits, you get a banner instead of being overwritten. |
| **Outline** | **Outline** panel builds a live table of contents from your headings. Click to jump. |
| Writing stats | Live word count, reading time, and "last edit by" in the status bar |
| Search | Filter documents in the sidebar (press `/` to focus) |
| Export | Download as Markdown or HTML, Print / Save as PDF |
| Safety | Server-side HTML sanitization, conflict detection (409) instead of silent overwrites, uniform 404 for documents you cannot access, login rate limiting, security headers |
| Resilience | Losing edit access mid-session switches the editor to read-only with a clear message; an expired session returns to sign-in with an explanation; a deleted document stops autosave and presence cleanly |
| Operations | gzip compression, long-term caching for fingerprinted assets (`index.html` always revalidated), `/api/health` checks the database (used by Render's health check), JSON access logs with a request id on every response, graceful shutdown on deploys |

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
| `JWT_SECRET` | dev default | Secret for signing session cookies. **Required in production**: the server refuses to start without it. |
| `DATABASE_POOL_MAX` | `10` | Max Postgres connections |
| `LOG_REQUESTS` | on in production | JSON access log line per API request |
| `DATABASE_SSL` | auto | Force Postgres SSL on (`true`) or off (`false`) |

## Tests

```bash
npm test
```

This runs 17 API integration tests (Node's built-in test runner + supertest) against an in-memory SQLite database. Set `TEST_DATABASE_URL` to run the same suite against Postgres. They cover:

- authentication (unauthenticated requests and wrong passwords are rejected)
- create, rename, save and reopen with formatting preserved
- sharing rules: a viewer can read but not edit, an editor can edit but not reshare or delete, strangers get 404, revoking removes access
- stale saves get 409 and never overwrite newer content
- XSS sanitization of stored content
- `.md` / `.txt` import, plus rejection of unsupported or missing files
- validation of titles, roles and unknown users
- version history: grouping, milestones, preview, restore, a baseline for pre-history documents, and viewer restrictions
- presence: who is in a document, live version reporting, leaving, and no access for strangers
- login rate limiting and security headers
- make a copy (ownership and isolation), health check (including database failure → 503) and request ids
- hardening: atomic delete with cascade, safe links (no reverse tabnabbing), request-id validation, presence cleanup, caching and compression headers

**CI:** GitHub Actions (`.github/workflows/ci.yml`) runs the suite on **both SQLite and Postgres 16**, plus the production build, on every push and pull request.

**Browser tests** (optional, Playwright, need a fresh database and the app running): `python e2e/smoke_test.py` and `python e2e/reliability_test.py`. The reliability test simulates real failures: going offline mid-edit, edit access revoked while typing, and the session expiring.

`e2e/smoke_test.py` It drives two browsers at once (Alice and Bob) through the full flow: editing, persistence, import, sharing, read-only mode, presence, live updates, outline, history restore and search.

## Deploy (Render, free)

The repo includes a `render.yaml` Blueprint with one free web service and one free Postgres database.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** and select the repo, then **Apply**.
3. Render creates the database, generates `JWT_SECRET`, runs `npm ci && npm run build`, and starts `npm start`. The demo users are seeded automatically on first boot.

## Project structure

```
server/
  index.js        boot: DB, seed, start HTTP server
  app.js          Express app: auth, documents, sharing, upload, history, presence, errors
  db.js           storage adapter (Postgres or SQLite, same SQL) + additive migrations
  content.js      HTML sanitization + .txt/.md/.docx → HTML conversion
  seed.js         demo users and the welcome document
  test/           API integration tests
client/src/
  App.jsx         layout, sidebar (owned vs shared), routing, import
  DocumentEditor.jsx  TipTap editor, autosave, conflicts, live updates, export
  HistoryPanel.jsx    version list, preview, restore
  OutlinePanel.jsx    heading navigation
  usePresence.jsx     presence heartbeat hook + avatars
  Toolbar.jsx     formatting toolbar
  SharePanel.jsx  share, change role, revoke
  Login.jsx       login with demo accounts
e2e/smoke_test.py browser smoke test (two users)
.github/workflows/ci.yml  CI: tests on SQLite + Postgres, production build
docs/screenshots/ screenshots of the main flows
```

See `ARCHITECTURE.md` for design decisions and `AI_WORKFLOW.md` for how I used AI tools.
