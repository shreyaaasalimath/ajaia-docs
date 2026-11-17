// Operational endpoints: health (used by the host's health check) and client config.
import express from 'express';
import { h } from '../http.js';
import { SUPPORTED_EXTENSIONS } from '../content.js';

export function systemRoutes({ db, options }) {
  const { maxUploadBytes, allowSignup, minPasswordLength, demoAccounts } = options;
  const router = express.Router();

  // Used by Render's health check: verifies the database, not just the process.
  router.get(
    '/health',
    h(async (_req, res) => {
      const started = Date.now();
      try {
        await db.query('SELECT 1 AS ok');
        res.json({ ok: true, db: db.kind, dbLatencyMs: Date.now() - started, uptimeS: Math.round(process.uptime()) });
      } catch {
        res.status(503).json({ ok: false, db: db.kind, error: 'Database unavailable' });
      }
    })
  );
  router.get('/config', (_req, res) =>
    res.json({ supportedExtensions: SUPPORTED_EXTENSIONS, maxUploadBytes, allowSignup, minPasswordLength, demoAccounts })
  );

  return router;
}
