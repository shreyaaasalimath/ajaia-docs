// API tests: run against a fresh in-memory SQLite database per test file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { seed, DEMO_PASSWORD } from '../seed.js';

let db;
let app;

before(async () => {
  // Set TEST_DATABASE_URL to run the same suite against Postgres (as CI does).
  db = await createDb(
    process.env.TEST_DATABASE_URL?.trim() ? { databaseUrl: process.env.TEST_DATABASE_URL } : { sqliteFile: ':memory:' }
  );
  await seed(db);
  app = createApp({ db, jwtSecret: 'test-secret' });
});

after(async () => db.close());

async function login(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  assert.equal(res.status, 200);
  return agent;
}

test('rejects unauthenticated requests and bad credentials', async () => {
  await request(app).get('/api/documents').expect(401);
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'alice@ajaia.test', password: 'wrong' })
    .expect(401);
});

test('owner can create, rename, save and reopen a document with formatting preserved', async () => {
  const alice = await login('alice@ajaia.test');
  const created = await alice.post('/api/documents').send({ title: 'Plan' }).expect(201);
  const { id, version } = created.body.document;

  const html = '<h2>Goals</h2><p><strong>Bold</strong> <em>it</em> <u>under</u></p><ol><li>one</li></ol>';
  const saved = await alice
    .patch(`/api/documents/${id}`)
    .send({ title: 'Q1 Plan', content: html, version })
    .expect(200);
  assert.equal(saved.body.document.version, version + 1);

  const reopened = await alice.get(`/api/documents/${id}`).expect(200);
  assert.equal(reopened.body.document.title, 'Q1 Plan');
  assert.equal(reopened.body.document.content, html);
  assert.equal(reopened.body.document.role, 'owner');
});

test('sharing: viewer can read but not edit, editor can edit, strangers get 404', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');

  const { body } = await alice.post('/api/documents').send({ title: 'Private' }).expect(201);
  const id = body.document.id;

  // Before sharing, Bob cannot see it at all.
  await bob.get(`/api/documents/${id}`).expect(404);

  // Share as viewer -> read-only.
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'viewer' }).expect(201);
  const asViewer = await bob.get(`/api/documents/${id}`).expect(200);
  assert.equal(asViewer.body.document.role, 'viewer');
  assert.equal(asViewer.body.document.shares, undefined, 'non-owners must not see the share list');
  await bob.patch(`/api/documents/${id}`).send({ content: '<p>hi</p>', version: 1 }).expect(403);

  // It shows up under "shared", not "owned".
  const list = await bob.get('/api/documents').expect(200);
  assert.ok(list.body.shared.some((d) => d.id === id && d.owner.email === 'alice@ajaia.test'));
  assert.ok(!list.body.owned.some((d) => d.id === id));

  // Upgrade to editor -> can edit; still cannot reshare or delete.
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(201);
  await bob.patch(`/api/documents/${id}`).send({ content: '<p>hi</p>', version: 1 }).expect(200);
  await bob.post(`/api/documents/${id}/shares`).send({ email: 'carol@ajaia.test' }).expect(403);
  await bob.delete(`/api/documents/${id}`).expect(403);

  // Carol was never invited.
  await carol.get(`/api/documents/${id}`).expect(404);

  // Revoke -> Bob loses access.
  const bobId = (await bob.get('/api/auth/me')).body.user.id;
  await alice.delete(`/api/documents/${id}/shares/${bobId}`).expect(200);
  await bob.get(`/api/documents/${id}`).expect(404);
});

test('stale saves are rejected with 409 instead of overwriting', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Race' }).expect(201);
  const { id, version } = body.document;
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>first</p>', version }).expect(200);
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>stale</p>', version }).expect(409);
  const doc = await alice.get(`/api/documents/${id}`);
  assert.equal(doc.body.document.content, '<p>first</p>');
});

test('stored content is sanitized (no scripts or event handlers)', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice
    .post('/api/documents')
    .send({ title: 'XSS', content: '<p onclick="x()">ok</p><script>alert(1)</script><img src=x onerror=y>' })
    .expect(201);
  assert.equal(body.document.content, '<p>ok</p>');
});

test('upload: .md becomes a new editable document; unsupported types are rejected', async () => {
  const alice = await login('alice@ajaia.test');
  const md = '# Meeting notes\n\n- **Decision**: ship it\n- _Owner_: Alice\n';
  const res = await alice
    .post('/api/documents/import')
    .attach('file', Buffer.from(md), 'meeting-notes.md')
    .expect(201);
  assert.equal(res.body.document.title, 'meeting-notes');
  assert.match(res.body.document.content, /<h1>Meeting notes<\/h1>/);
  assert.match(res.body.document.content, /<li><strong>Decision<\/strong>: ship it<\/li>/);

  const txt = await alice
    .post('/api/convert')
    .attach('file', Buffer.from('line one\n\nline <two>'), 'notes.txt')
    .expect(200);
  assert.equal(txt.body.html, '<p>line one</p><p>line &lt;two&gt;</p>');

  await alice.post('/api/documents/import').attach('file', Buffer.from('MZ'), 'virus.exe').expect(415);
  await alice.post('/api/documents/import').expect(400);
});

test('validation: empty titles and invalid roles are rejected', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Valid' }).expect(201);
  await alice.patch(`/api/documents/${body.document.id}`).send({ title: '   ', version: 1 }).expect(400);
  await alice
    .post(`/api/documents/${body.document.id}/shares`)
    .send({ email: 'bob@ajaia.test', role: 'admin' })
    .expect(400);
  await alice
    .post(`/api/documents/${body.document.id}/shares`)
    .send({ email: 'nobody@ajaia.test' })
    .expect(404);
});

test('version history: edits are snapshotted, previewable and restorable', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'History', content: '<p>v1</p>' }).expect(201);
  const id = body.document.id;

  // Same-author autosaves within the session window fold into one entry.
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>v2</p>', version: 1 }).expect(200);
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>v3</p>', version: 2 }).expect(200);
  let list = (await alice.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
  assert.equal(list.length, 2, 'creation milestone + one editing session');
  assert.equal(list[1].note, 'Created');

  // A different author starts a new entry.
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(201);
  const bobSave = await bob.patch(`/api/documents/${id}`).send({ content: '<p>bob</p>', version: 3 }).expect(200);
  assert.equal(bobSave.body.document.updatedBy.name, 'Bob Teammate');
  list = (await alice.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
  assert.equal(list.length, 3);
  assert.equal(list[0].author, 'Bob Teammate');

  // Preview and restore the original.
  const created = list.find((v) => v.note === 'Created');
  const preview = await alice.get(`/api/documents/${id}/versions/${created.id}`).expect(200);
  assert.equal(preview.body.version.content, '<p>v1</p>');
  const restored = await alice.post(`/api/documents/${id}/versions/${created.id}/restore`).expect(200);
  assert.equal(restored.body.document.content, '<p>v1</p>');
  list = (await alice.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
  assert.match(list[0].note, /^Restored version from/);

  // Viewers cannot see or restore history.
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'viewer' }).expect(201);
  await bob.get(`/api/documents/${id}/versions`).expect(403);
  await bob.post(`/api/documents/${id}/versions/${created.id}/restore`).expect(403);
});

test('presence: collaborators see each other and the latest saved version', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Live' }).expect(201);
  const id = body.document.id;
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(201);

  await alice.post(`/api/documents/${id}/presence`).send({ editing: true }).expect(200);
  const seen = await bob.post(`/api/documents/${id}/presence`).send({ editing: false }).expect(200);
  assert.deepEqual(seen.body.viewers.map((v) => [v.name, v.editing]), [['Alice Owner', true]]);
  assert.equal(seen.body.version, 1);

  await alice.patch(`/api/documents/${id}`).send({ content: '<p>new</p>', version: 1 }).expect(200);
  const after = await bob.post(`/api/documents/${id}/presence`).send({}).expect(200);
  assert.equal(after.body.version, 2);
  assert.equal(after.body.updatedBy.name, 'Alice Owner');

  // Leaving removes you; strangers cannot probe presence.
  await alice.delete(`/api/documents/${id}/presence`).expect(204);
  assert.equal((await bob.post(`/api/documents/${id}/presence`).send({})).body.viewers.length, 0);
  await carol.post(`/api/documents/${id}/presence`).send({}).expect(404);
});

test('security: failed logins are rate limited and security headers are set', async () => {
  const limited = createApp({ db, jwtSecret: 'test-secret', loginAttemptsPerWindow: 3 });
  for (let i = 0; i < 3; i++) {
    await request(limited).post('/api/auth/login').send({ email: 'alice@ajaia.test', password: 'nope' }).expect(401);
  }
  const blocked = await request(limited)
    .post('/api/auth/login')
    .send({ email: 'alice@ajaia.test', password: 'nope' })
    .expect(429);
  assert.match(blocked.body.error, /Too many/);

  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('version history: documents created before history get a restorable baseline', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Legacy', content: '<p>original</p>' }).expect(201);
  const id = body.document.id;
  await db.query('DELETE FROM document_versions WHERE document_id = $1', [id]); // simulate a pre-history doc
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>edited</p>', version: 1 }).expect(200);
  const list = (await alice.get(`/api/documents/${id}/versions`).expect(200)).body.versions;
  const baseline = list.find((v) => v.note === 'Original version');
  assert.ok(baseline, 'baseline snapshot exists');
  const preview = await alice.get(`/api/documents/${id}/versions/${baseline.id}`).expect(200);
  assert.equal(preview.body.version.content, '<p>original</p>');
});

test('make a copy: any collaborator gets their own copy as owner', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Template', content: '<h1>Plan</h1>' }).expect(201);
  const id = body.document.id;
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test', role: 'viewer' }).expect(201);

  const copy = await bob.post(`/api/documents/${id}/copy`).expect(201);
  assert.equal(copy.body.document.title, 'Copy of Template');
  assert.equal(copy.body.document.role, 'owner');
  assert.equal(copy.body.document.content, '<h1>Plan</h1>');
  // The copy is Bob's alone: editable by him, invisible to Alice.
  await bob.patch(`/api/documents/${copy.body.document.id}`).send({ content: '<p>mine</p>', version: 1 }).expect(200);
  await alice.get(`/api/documents/${copy.body.document.id}`).expect(404);
  await carol.post(`/api/documents/${id}/copy`).expect(404);
});

test('ops: health checks the database and every response carries a request id', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Number.isInteger(res.body.dbLatencyMs));
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  const echoed = await request(app).get('/api/health').set('X-Request-Id', 'trace-123');
  assert.equal(echoed.headers['x-request-id'], 'trace-123');

  const broken = createApp({ db: { kind: 'test', query: async () => { throw new Error('down'); } }, jwtSecret: 'x' });
  const down = await request(broken).get('/api/health').expect(503);
  assert.equal(down.body.ok, false);
});

test('hardening: deleting a document removes its shares and history in one step', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Doomed', content: '<p>x</p>' }).expect(201);
  const id = body.document.id;
  await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@ajaia.test' }).expect(201);
  await alice.patch(`/api/documents/${id}`).send({ content: '<p>y</p>', version: 1 }).expect(200);
  await alice.delete(`/api/documents/${id}`).expect(204);
  const [shares] = await db.query('SELECT COUNT(*) AS n FROM document_shares WHERE document_id = $1', [id]);
  const [versions] = await db.query('SELECT COUNT(*) AS n FROM document_versions WHERE document_id = $1', [id]);
  assert.equal(Number(shares.n), 0);
  assert.equal(Number(versions.n), 0);
});

test('hardening: links are forced to open safely (no reverse tabnabbing)', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice
    .post('/api/documents')
    .send({ content: '<p><a href="https://example.com" target="_self" onclick="x()">site</a><a href="javascript:alert(1)">bad</a></p>' })
    .expect(201);
  assert.equal(
    body.document.content,
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a><a target="_blank" rel="noopener noreferrer nofollow">bad</a></p>'
  );
});

test('hardening: unsafe incoming request ids are replaced, presence cleans up after itself', async () => {
  const res = await request(app).get('/api/health').set('X-Request-Id', '<script>alert(1)</script> ' + 'x'.repeat(100));
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);

  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents').send({ title: 'Presence cleanup' }).expect(201);
  await alice.post(`/api/documents/${body.document.id}/presence`).send({}).expect(200);
  assert.ok(app.locals.presence.has(body.document.id));
  await alice.delete(`/api/documents/${body.document.id}/presence`).expect(204);
  assert.ok(!app.locals.presence.has(body.document.id), 'empty presence entries are removed');
});

test('hardening: hashed assets are cached forever, index.html is revalidated, responses are compressed', async (t) => {
  const { fileURLToPath } = await import('node:url');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (!fs.existsSync(path.join(dist, 'assets'))) return t.skip('run "npm run build" first');
  const served = createApp({ db, jwtSecret: 'x', clientDist: dist });
  const js = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.js'));
  const asset = await request(served).get(`/assets/${js}`).set('Accept-Encoding', 'gzip').expect(200);
  assert.match(asset.headers['cache-control'], /max-age=31536000.*immutable/);
  assert.equal(asset.headers['content-encoding'], 'gzip');
  const page = await request(served).get('/some/deep/link').expect(200);
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.match(page.text, /<div id="root">/);
});
