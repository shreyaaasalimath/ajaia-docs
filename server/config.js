// All runtime settings in one place, read from environment variables with
// sensible defaults. Nothing operational is hardcoded elsewhere in the server.
const int = (name, fallback, { min = 1 } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`Invalid ${name}: "${raw}" (expected a number >= ${min})`);
  return n;
};
const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  return {
    production,
    port: int('PORT', 3001),
    databaseUrl: process.env.DATABASE_URL || undefined,
    sqliteFile: process.env.SQLITE_FILE || undefined,
    jwtSecret: process.env.JWT_SECRET || (production ? undefined : 'dev-only-secret-change-me'),
    sessionDays: int('SESSION_DAYS', 7),
    allowSignup: bool('ALLOW_SIGNUP', true),
    // Demo accounts let reviewers test sharing without signing up; turn off for a real deployment.
    seedDemoData: bool('SEED_DEMO_DATA', true),
    // No fallback in production: shipping a well-known password must be a deliberate choice.
    demoPassword: process.env.DEMO_PASSWORD || (production ? undefined : 'password123'),
    minPasswordLength: int('MIN_PASSWORD_LENGTH', 8),
    loginAttemptsPerWindow: int('LOGIN_ATTEMPTS_PER_15_MIN', 10),
    signupsPerHour: int('SIGNUPS_PER_HOUR_PER_IP', 10),
    uploadsPerMinute: int('UPLOADS_PER_MINUTE', 20),
    maxUploadBytes: int('MAX_UPLOAD_MB', 2) * 1024 * 1024,
    versionSessionMs: int('VERSION_SESSION_MINUTES', 5) * 60 * 1000,
    maxVersionsPerDoc: int('MAX_VERSIONS_PER_DOC', 100),
    logRequests: bool('LOG_REQUESTS', production),
  };
}
