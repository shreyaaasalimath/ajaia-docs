import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set; using an insecure default.');
}

const db = await createDb({
  databaseUrl: process.env.DATABASE_URL,
  sqliteFile: process.env.SQLITE_FILE,
});
await seed(db);

const app = createApp({
  db,
  jwtSecret: JWT_SECRET,
  clientDist: path.resolve(__dirname, '..', 'client', 'dist'),
});

app.listen(PORT, () => {
  console.log(`Ajaia Docs running on http://localhost:${PORT} (storage: ${db.kind})`);
});
