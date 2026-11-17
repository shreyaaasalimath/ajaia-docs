# Architecture Note

## What I optimized for

The brief asks for depth in a few areas over shallow coverage of everything. I chose to make four things solid end to end: **the editing loop**, **sharing with real access rules**, **file import**, and **a deployment that a reviewer can actually test**. Everything else I either cut on purpose or kept small.

## Shape of the system

```
Browser (React + TipTap)  ──JSON/HTTP──>  Express API  ──SQL──>  Postgres (prod) / SQLite (local, tests)
        │                                     │
        └── static client served by the same Node process (one deployable unit)
```

- **One service, one database.** The API also serves the built client, so there is one URL, no CORS, and same-site cookies just work. For this scope, a separate frontend host would add moving parts without adding value.
- **Storage adapter (`server/db.js`).** All SQL uses portable types (TEXT ids, ISO timestamps) and `$1` placeholders. The SQLite adapter rewrites the placeholders. Reviewers can run the app locally with zero setup, and production gets a real managed database. The same test suite passes on both engines.

## Key decisions and tradeoffs

**1. TipTap (ProseMirror) for the editor, HTML as the stored format.**
TipTap gives reliable rich text, keyboard shortcuts, undo history and a schema that prevents invalid structure. I store HTML rather than ProseMirror JSON because it is readable, easy to export, and it is the format that `.md` and `.docx` imports convert into anyway. The cost is that HTML is a looser format, so every write goes through a server-side allowlist sanitizer (`content.js`). This matters because shared documents render in *other* users' browsers, which makes stored XSS a real risk.

**2. Autosave + optimistic concurrency instead of real-time collaboration.**
Real-time co-editing (CRDT/OT, presence) is the biggest Google Docs feature and the easiest way to blow the timebox. Instead, each document has a `version` number. Saves send the version they were based on, the server updates with `WHERE version = $n`, and a stale save returns **409** instead of silently overwriting a collaborator's work. The UI then asks the user to reload. This is honest, safe behavior for occasional concurrent edits, and it leaves a clean path to real-time later.

**3. Sharing model: owner + per-user role (`editor` / `viewer`).**
A `document_shares` table with a composite key `(document_id, user_id)`. One function (`loadDocWithRole`) resolves the caller's role, and every endpoint checks it: only owners can share, revoke or delete; editors can edit; viewers can only read (enforced on the server, and the UI also switches to a read-only editor). Documents you cannot access return **404, not 403**, so document ids do not leak. Re-sharing is an upsert, so changing a role is the same call as granting access.

**4. Auth: seeded users + password login with an httpOnly JWT cookie.**
This is real enough to demonstrate ownership and sharing across accounts (passwords are bcrypt-hashed, and the cookie is httpOnly, SameSite=Lax, and Secure in production), but there is no sign-up, password reset or OAuth. That was a deliberate cut.

**5. File upload as a product feature, not a storage feature.**
Uploads convert into editable content (`.txt` → paragraphs, `.md` → marked, `.docx` → mammoth). You can create a new document from a file or insert a file into the current draft. Files are processed in memory and not stored, which avoids file storage, which the free hosting tier does not persist anyway. Limits are explicit: 2 MB, three extensions, with a 415 error and a UI message for anything else.

## What I deliberately did not build

| Cut | Why |
|---|---|
| Real-time co-editing, cursors, presence | Largest scope risk. Replaced with conflict detection. |
| Comments / suggestion mode, version history | Valuable, but each is a feature-sized project. Not needed to prove the core loop. |
| Sign-up, password reset, OAuth | Seeded accounts are enough to demonstrate access logic. |
| Images, tables, fonts, colors | Kept the formatting set to what the brief asks for, done well. |
| Storing uploaded files as attachments | Needs object storage. Converting to content is the more useful behavior here. |
| Link-sharing / public docs, org-level permissions | Per-user roles cover the brief. |

Small stretch item included: **export to Markdown / HTML and Print → PDF**. These are all client-side, cheap, and useful.

## Validation and error handling

- Server: title required and at most 200 chars; content must be a string and at most 1 MB; role must be `viewer` or `editor`; unknown share email → 404; upload size, type and missing file → 413 / 415 / 400; malformed JSON → 400; unexpected errors → generic 500 (details only in server logs).
- Client: file type and size checked before upload; empty title blocks saving with an inline message; every API error is surfaced as a toast or an inline message; the save status shows saved / saving / unsaved / failed / conflict.

## What I would do next with 2–4 more hours

1. **Real-time collaboration** with Yjs + TipTap's collaboration extension over WebSockets (I have WebSocket experience from CrisisIQ). The version column becomes a snapshot checkpoint.
2. **Version history**: write a row to `document_versions` on each save and add a restore button. This is cheap given the existing version counter.
3. **Comments** anchored to text ranges.
4. **Frontend tests** (Vitest + Testing Library) for the save state machine, plus Playwright in CI.
5. Rate limiting on login and upload, CSRF token for state-changing requests, and structured logging.
