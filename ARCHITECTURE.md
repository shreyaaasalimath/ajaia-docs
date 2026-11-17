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

**6. Version history as grouped snapshots.**
A `document_versions` table stores full snapshots (documents are small, so full copies are simpler and safer than diffs). Saving every autosave would bury useful history under hundreds of entries, so autosaves by the same author within 5 minutes update the latest snapshot, much like an "editing session" in Google Docs. Milestones (Created, Imported, Restored) are never modified, so they can always be restored exactly. Restoring writes a *new* version instead of deleting history, which makes restores undoable. Documents created before history existed get a baseline snapshot before their first change, so upgrading the live database loses nothing.

**7. Presence and live updates over polling, not WebSockets.**
Each open editor sends a heartbeat every 4 s (15 s when the tab is hidden). The response lists who else is present and the document's current version. If a collaborator saved and you have no unsaved edits, the client pulls the new content and **maps your cursor through the change** using ProseMirror's `findDiffStart`/`findDiffEnd`, so text inserted above you does not make your cursor jump. If you do have unsaved edits, you get a banner instead of being overwritten. Polling was a deliberate choice: it works through every proxy and on a free host that sleeps, it reuses the existing REST and auth path, and it gives "near real-time" with very little code. Presence is kept in memory, which is correct for a single instance. Scaling out would move it to Redis or replace it with a WebSocket channel.

**8. Production hardening.** A health check that actually queries the database (so Render restarts an instance that lost its DB, rather than only checking that the process is alive); structured JSON access logs with a request id that is returned in a header and in 500 responses, so a user-reported error can be found in the logs; graceful shutdown on SIGTERM so in-flight saves finish during deploys; additive, idempotent migrations at boot (the live database was upgraded in place); failed-login rate limiting; security headers (`nosniff`, `DENY` framing, referrer policy); `trust proxy` for real client IPs behind Render; and CI that runs every test on both database engines plus the production build.

**9. Failure handling on the client.** Autosave treats failures by type. Network errors, 5xx and 429 are retried with exponential backoff (2 s → 30 s), and immediately on the browser's `online` event. 409 stops and offers "Load latest". 403 means the owner changed my access, so the editor becomes read-only. 404 means the document is gone. 401 returns to sign-in. In every failure case the edit stays marked as unsaved, so the close-tab warning still protects it.

**10. Security review notes.**
- Sessions: httpOnly, `SameSite=Lax`, and `Secure` cookies. Lax blocks cross-site POST/PATCH/DELETE from carrying the cookie, which is the CSRF protection for this scope; a CSRF token would be the next step for stricter requirements.
- Login takes the same bcrypt time for unknown emails (no user enumeration by timing) and is rate limited; uploads are rate limited per user.
- The server will not start in production without `JWT_SECRET`.
- Stored HTML is allowlist-sanitized on every write; links are forced to `rel="noopener noreferrer nofollow"`.
- **Known, accepted dependency advisories** (from `npm audit`): (a) TipTap `mergeAttributes` prototype-key issue, fixed only in TipTap v3, a major upgrade I chose not to do inside the timebox. It requires attacker-controlled node attributes, and the server sanitizer removes every non-allowlisted attribute before content is stored or shown to anyone else. (b) `picomatch` ReDoS via Vite, build-time only and applied to our own config globs, never user input; no patched release exists yet.

## What I deliberately did not build

| Cut | Why |
|---|---|
| True real-time co-editing (CRDT), remote cursors | Largest scope risk. Replaced with presence, live pull of saved changes, and conflict detection. |
| Comments / suggestion mode | Valuable, but a feature-sized project. Version history and presence gave more collaboration value for the time. |
| Sign-up, password reset, OAuth | Seeded accounts are enough to demonstrate access logic. |
| Images, tables, fonts, colors | Kept the formatting set to what the brief asks for, done well. |
| Storing uploaded files as attachments | Needs object storage. Converting to content is the more useful behavior here. |
| Link-sharing / public docs, org-level permissions | Per-user roles cover the brief. |

Stretch items included: **version history**, **presence with live updates**, **outline**, and **export to Markdown / HTML / PDF**.

## Validation and error handling

- Server: title required and at most 200 chars; content must be a string and at most 1 MB; role must be `viewer` or `editor`; unknown share email → 404; upload size, type and missing file → 413 / 415 / 400; malformed JSON → 400; unexpected errors → generic 500 (details only in server logs).
- Client: file type and size checked before upload; empty title blocks saving with an inline message; every API error is surfaced as a toast or an inline message; the save status shows saved / saving / unsaved / failed / conflict.

## What I would do next with 2–4 more hours

1. **True real-time co-editing** with Yjs + TipTap's collaboration extension over WebSockets, including remote cursors (I have WebSocket experience from CrisisIQ). The presence endpoint and version snapshots already provide the surrounding pieces.
2. **Comments** anchored to text ranges, with resolve and notify.
3. **Diff view** between two versions in the History panel.
4. **Frontend tests** (Vitest + Testing Library) for the save and remote-update state machine, plus Playwright in CI.
5. CSRF token for state-changing requests, upload rate limiting, and structured logging with request ids.
