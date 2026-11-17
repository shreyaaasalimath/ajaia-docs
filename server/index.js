import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { seed, demoAccounts } from './seed.js';
import { loadConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
}

// Refuse to start in production with the public default secret: anyone could
// forge a session cookie for any user.
if (!config.jwtSecret) {
  console.error('FATAL: JWT_SECRET must be set in production.');
  process.exit(1);
}

process.on('unhandledRejection', (err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'unhandledRejection', error: String(err?.stack || err) }));
});

const db = await createDb({ databaseUrl: config.databaseUrl, sqliteFile: config.sqliteFile });
if (config.seedDemoData && !config.demoPassword) {
  console.error('FATAL: SEED_DEMO_DATA is on but DEMO_PASSWORD is not set. Set it, or set SEED_DEMO_DATA=false.');
  process.exit(1);
}
if (config.seedDemoData) await seed(db, { password: config.demoPassword });

const app = createApp({
  db,
  clientDist: path.resolve(__dirname, '..', 'client', 'dist'),
  ...config,
  demoAccounts: config.seedDemoData ? demoAccounts(config.demoPassword) : [],
  secureCookies: config.production,
});

const server = app.listen(config.port, () => {
  console.log(`Ajaia Docs running on http://localhost:${config.port} (storage: ${db.kind}, sign-up: ${config.allowSignup ? 'on' : 'off'}, demo data: ${config.seedDemoData ? 'on' : 'off'})`);
});

// Graceful shutdown: Render sends SIGTERM on every deploy. Stop accepting new
// connections, let in-flight saves finish, then close the database pool.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: finishing in-flight requests…`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await db.close().catch(() => {});
      console.log('Shutdown complete');
      process.exit(0);
    });
  });
}
