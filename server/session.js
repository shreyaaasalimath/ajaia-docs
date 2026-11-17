// Cookie-based sessions: a signed JWT in an httpOnly, SameSite=Lax cookie.
import jwt from 'jsonwebtoken';
import { HttpError, h } from './http.js';

const COOKIE = 'ajaia_session';

export function createSession({ db, jwtSecret, sessionDays, secureCookies }) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies };

  function startSession(res, userId) {
    const token = jwt.sign({ sub: userId }, jwtSecret, { expiresIn: `${sessionDays}d` });
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: sessionDays * 24 * 3600 * 1000 });
  }

  function clearSession(res) {
    res.clearCookie(COOKIE, cookieOptions);
  }

  const requireUser = h(async (req, _res, next) => {
    const token = req.cookies[COOKIE];
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const [user] = await db.query('SELECT id, email, name FROM users WHERE id = $1', [payload.sub]);
    if (!user) throw new HttpError(401, 'Not signed in');
    req.user = user;
    next();
  });

  return { startSession, clearSession, requireUser };
}
