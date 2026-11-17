# AI-Native Workflow Note

> **In 30 seconds**
> - **Tool:** Claude as a coding assistant that could run code, tests and a headless browser.
> - **Where it sped me up:** boilerplate, library glue (TipTap, mammoth, sanitize-html), writing tests, and rerunning browser checks after every change.
> - **What was not left to the AI alone:** scope cuts, permission rules, and conflict and failure behaviour were proposed with the assistant, reviewed and accepted by me, and each one is pinned down by a test.
> - **What I rejected or fixed:** the table below lists real defects in AI-generated code, including silent data loss after a failed save and a privacy leak in the user directory, each found by a test, a log or a review.
> - **How I verified:** 23 API tests on SQLite and Postgres in CI, two browser suites (normal use and failure modes), production-build checks, and reading the server logs for unexpected errors.

## Tools I used

- **Claude (Anthropic)** as an agentic coding assistant with a sandboxed shell. I used it to scaffold, write and run code, run tests, and drive a headless browser.
- **Playwright** (driven through the assistant) for browser-level verification and screenshots.
- I did not use AI for product decisions without reviewing them. Scope, data model and access rules were decided up front and then implemented.

## How I worked

I treated the AI as a fast pair programmer working inside a tight loop: **decide → generate → run → inspect → correct**. I did not accept code because it looked right. I accepted it once it passed a test I could see.

1. **Scoping first, without code.** I read the brief and committed to a slice: editing loop, sharing with real roles, file import, deployable build. I explicitly cut real-time collaboration, comments and auth flows (see `ARCHITECTURE.md`). I also fixed the stack early (React + TipTap, Express, Postgres/SQLite) so that generation stayed consistent.
2. **Backend and tests before UI.** I had the API and integration tests generated together, so the access rules (owner / editor / viewer / stranger) were pinned down by tests before any UI existed.
3. **UI, then real-browser verification.** After the build, I ran a Playwright script through the full flow: login, create, rename, format, autosave, reload, import, share, log in as the other user, confirm read-only. I also reviewed screenshots of each screen.
4. **Production parity check.** I reproduced the exact Render build command in a clean folder and ran the app in production mode against a real Postgres 16 instance, then repeated the test suite and the browser flow there.

## Where AI materially sped me up

- **Boilerplate at volume:** Express routes, the fetch wrapper, the TipTap toolbar and the CSS. This is the work that would have taken most of the timebox by hand.
- **Library glue:** mammoth (`.docx`), marked (`.md`), sanitize-html allowlists, TipTap extensions. The AI knew the APIs, which saved documentation lookups.
- **Test writing:** the 7 API tests covering the sharing permission matrix were written in minutes, which let me spend more time on edge cases.
- **Verification:** writing and rerunning the browser smoke test on every change was cheap enough that I did it repeatedly instead of once at the end.

## What I changed or rejected

These are real issues caught during the build, not hypothetical ones:

| AI output | Problem found | What I did |
|---|---|---|
| SQLite adapter mapped `$1` → `?1` numbered params | All tests failed with `RangeError` from better-sqlite3 | Rewrote it to translate placeholders to positional `?` and reorder params, which also handles a placeholder used twice (`$5` for both timestamps) |
| Deploy command `npm ci --omit=optional` (to skip SQLite in production) | Reproducing the build in a clean folder showed it also strips Rollup's native binary, so **the Vite build fails on Render** | Moved SQLite to `devDependencies` (which production installs skip) and kept the plain `npm ci` |
| Postgres SSL turned on for any non-localhost host | Render's internal database hostname is private, so forcing SSL there is fragile | SSL now depends on the host (public hostnames on, private/internal off) with a `DATABASE_SSL` override |
| Editor flushed pending changes on unmount by calling `editor.getHTML()` | The browser test showed that switching documents quickly could read from an editor that was already being destroyed | Kept the latest HTML in a ref on each update, and save reads from the ref. Added a "type and immediately switch documents" step to the smoke test. |
| Save callback depended on `doc.title` | The callback identity changed after every rename, which re-ran effects and could trigger extra saves | Tracked the last-saved title in a ref so the save function stays stable |
| Browser test typed into the editor right after clicking "New document" | It passed on SQLite but failed on Postgres: the test typed into the *previous* document before navigation finished | Fixed the test to wait for the route and the new document's title. A good reminder that a test passing once does not make it reliable. |
| Version snapshots grouped every same-author save in a 5-minute window | A new test showed the first autosave **overwrote the "Created" snapshot**, so the original content could never be restored | Entries with a note (Created, Imported, Restored) are now fixed milestones that are never modified |
| Version history started recording at the first save after deploy | The two-browser test on a database created by the *previous* release showed existing documents had no restorable original | Added a baseline "Original version" snapshot before a document's first change, plus a test that simulates a pre-history document |
| Remote updates restored the cursor at the same absolute position | Debugging with two browsers showed the cursor drifting when a collaborator inserted text above it | Mapped the cursor through the change with ProseMirror's `findDiffStart`/`findDiffEnd`, then verified it lands on exactly the same spot |
| Browser test used `End` / `Ctrl+End` to reach the end of the document | Typed text landed in the middle of a wrapped list item. I confirmed this was the test, not the editor, before changing anything. | Placed the caret with the Selection API in the test |
| Autosave cleared the "unsaved" flag before sending, and did not restore it on failure | A code review pass found that after a failed save (offline, or the server restarting during a deploy) the app believed everything was saved: no retry and no close-tab warning, so **edits could be silently lost** | Failures now keep the edit marked unsaved and are handled by type (retry with backoff, read-only on 403, sign-in on 401). Verified by a browser test that goes offline mid-edit. |
| `editor.setEditable(canEdit)` to follow role changes | The server logs during the browser test showed unexpected 403s and a 409: TipTap fires an update event on `setEditable`, so **merely opening a document triggered an autosave** | Pass `emitUpdate=false`, and guard autosave so a viewer can never schedule one. I now check the server log for unexpected 4xx/5xx after every browser run. |
| Read-only switch after losing access | The new reliability test showed the "your edits were not saved" message was hidden as soon as the role flipped to viewer | Kept the status visible in that state |
| `npm audit fix --force` (suggested by npm) | Would jump TipTap to v3 (breaking) in the last hours of the timebox | Applied only non-breaking fixes and documented the two remaining advisories with why they are not exploitable here |
| `/api/users` listed every account for the share dialog | Fine with three seeded users, but once sign-up existed it meant **any new user could read every customer's name and email** | Suggestions are limited to people you already collaborate with (plus the public demo accounts in demo mode); a test signs up a stranger and checks they never appear |
| Splitting a 750-line `app.js` into route modules | The test suite caught a regression introduced during the move: the history list limit had been tied to the retention cap, which hid the protected "Created" milestone | Kept the two limits separate and named them; refactors only land when the API and both browser suites pass |
| Content-Security-Policy `script-src 'self'` | Playwright's `wait_for_function` relies on `eval`, which the policy blocks, so a test failed | Kept the strict policy; the failure-mode test now polls from Python and also fails if the app itself ever violates the policy |
| `.env.example` documented, but nothing loaded `.env` | Noticed while writing the setup docs; following them would silently do nothing | `npm start` / `npm run dev` use Node's `--env-file-if-exists`, verified by changing a limit through `.env` |
| Suggestion to store uploads as file attachments | Needs object storage, and Render's free disk is not persistent | Rejected. Uploads convert into editable content instead, which is the more useful product behavior. |

## How I verified correctness, UX quality and reliability

- **Correctness:** 23 API integration tests (`npm test`) covering auth, the sharing permission matrix, persistence of formatting, 409 conflict handling, XSS sanitization, upload conversion, version history, presence, rate limiting and validation. **CI runs them on both SQLite and Postgres** on every push.
- **Upgrade safety:** before shipping the second iteration, I started the *previous* release against a database, then ran the new release on top of it. This proved the migration and the history baseline on the same kind of data the live app has.
- **UX:** an end-to-end Playwright run through the real UI with **two browsers open at once** (presence, live updates, restore propagating to the other user), plus manual review of screenshots (which caught loose list spacing and a toast message carrying over after sign-out, both fixed).
- **Failure modes:** a second browser test (`e2e/reliability_test.py`) cuts the network mid-edit, revokes edit access while the user is typing, and expires the session, then checks that nothing is lost or overwritten.
- **Reliability:** reproduced the exact production build and ran it with `NODE_ENV=production` against Postgres before deploying, which caught the build-breaking dependency issue above.
- **Security review:** I checked that permissions are enforced on the server and not only hidden in the UI (viewer PATCH → 403, stranger GET → 404), and that stored HTML is sanitized on every write.

## Takeaway

AI made it realistic to ship a tested, deployed full-stack slice in the timebox. The value I added was in scoping, in deciding what "correct" means (the permission matrix, conflict behavior, sanitization), and in refusing to trust output until it ran in conditions that match production. Most of the bugs above only appeared because I tested in a clean, production-like environment rather than trusting that generated code that looked right was right.
