# Submission: Ajaia AI-Native Full Stack Developer Assignment

**Candidate:** Shreya Basavaraj Salimath
**Live app:** `<LIVE_URL>`
**Walkthrough video:** `<VIDEO_URL>` (also in `VIDEO_URL.txt`)
**Source code:** `<GITHUB_URL>` (also included in this folder)

## How to review in 3 minutes

1. Open the live app. (On Render's free tier, the first load after idle can take about 30–50 s.)
2. Sign in as **alice@ajaia.test** / `password123`. Open "Welcome to Ajaia Docs", edit and format text, and watch "All changes saved".
3. Click **+ New document**, rename it, and use **Share** to share it with `bob@ajaia.test` as **Can view**.
4. Sign out and sign in as **bob@ajaia.test**. Both documents appear under **Shared with me**. The new one is read-only, and the welcome doc is editable.
5. Try **Import file** with a `.md`, `.txt` or `.docx` file.

| Test account | Password | Notes |
|---|---|---|
| alice@ajaia.test | password123 | Owner of the seeded welcome doc |
| bob@ajaia.test | password123 | Seeded as editor on the welcome doc |
| carol@ajaia.test | password123 | Starts with no access |

## What is included

| Item | Location |
|---|---|
| Source code | `server/`, `client/`, `e2e/` |
| Setup and run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| This file | `SUBMISSION.md` |
| Walkthrough video URL | `VIDEO_URL.txt` |
| Screenshots | `docs/screenshots/` |
| Automated tests | `server/test/api.test.js` (run `npm test`), `e2e/smoke_test.py` |
| Deployment config | `render.yaml` |

## Status

**Working end to end**
- Create, rename, edit, autosave, reopen, delete documents
- Rich text: bold, italic, underline, strikethrough, H1–H3, bulleted and numbered lists, quote, code block, undo/redo
- File import: `.txt`, `.md`, `.docx` (max 2 MB) as a new document, or inserted into an existing one
- Sharing: owner, grant edit or view access by email, change role, revoke; owned vs shared shown separately; viewers are read-only (enforced on the server)
- Persistence in Postgres (production) and SQLite (local); formatting preserved
- Conflict detection (409) instead of silent overwrites
- Export to Markdown / HTML, and Print → PDF (stretch)
- 7 passing API tests, run on both SQLite and Postgres

**Incomplete / intentionally deprioritized**
- No real-time co-editing or presence (two people editing at once get a clear conflict message rather than merged edits)
- No comments, suggestion mode or version history
- No sign-up or password reset (seeded accounts only)
- No images or tables in documents; uploaded files are converted into content, not stored as attachments

**What I would build next with 2–4 hours:** real-time collaboration with Yjs over WebSockets, version history with restore (building on the existing version counter), comments, frontend unit tests, and rate limiting / CSRF hardening. Details are in `ARCHITECTURE.md`.
