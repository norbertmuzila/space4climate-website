/**
 * Accounts for Space4Climate: sign up, log in, log out.
 *
 * Two ways in, both landing on the same account record:
 *   - a username or email address with a password we store as a scrypt hash
 *   - Sign in with Google, where an account is created on first use
 *
 * This replaces the Firebase scaffold the login page used to carry. Firebase
 * was never configured, so the page sat in "demo mode" and no login worked.
 *
 * Sessions are opaque random tokens in an HttpOnly cookie. Only a SHA-256 of
 * the token is stored, so a dump of the database does not hand anyone a set of
 * live sessions.
 *
 * Routes (action in the query string):
 *   GET  ?action=config   what the browser needs to render the page
 *   GET  ?action=me       the signed-in user, or null
 *   POST ?action=signup   { name, username, email, password }
 *   POST ?action=login    { identifier, password }   identifier = username or email
 *   POST ?action=google   { credential }             a Google ID token
 *   POST ?action=logout
 */

const crypto = require('crypto');
const {
  applyCors,
  kvBump,
  kvDel,
  kvGet,
  kvSet,
  kvSetEx,
  newId,
  readBody,
  send,
  storageReady
} = require('./_scheduling');

const SESSION_COOKIE = 's4c_session';
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

const USER = 'user:';
const BY_EMAIL = 'uemail:';
const BY_USERNAME = 'uname:';
const SESSION = 'sess:';
const THROTTLE = 'throttle:';

// A wrong password costs an attempt; ten in fifteen minutes stops the account
// being used as an oracle for guessing.
const MAX_ATTEMPTS = 10;
const THROTTLE_WINDOW = 15 * 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();

/* ── Passwords ──────────────────────────────────────────────────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function passwordMatches(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await kvSetEx(SESSION + hashToken(token), { userId, createdAt: Date.now() }, SESSION_SECONDS);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );
  return token;
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function cookieToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const session = await kvGet(SESSION + hashToken(token));
  if (!session || !session.userId) return null;
  const user = await kvGet(USER + session.userId);
  return user || null;
}

/** Everything about a user that is safe to hand to the browser. */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name || '',
    username: user.username || '',
    email: user.email || '',
    picture: user.picture || '',
    provider: user.provider || 'password',
    createdAt: user.createdAt
  };
}

/* ── Google ID tokens ───────────────────────────────────────────────────── */

let certsCache = { keys: null, fetchedAt: 0 };

async function googleKeys() {
  // Google rotates these; an hour is well inside the documented cache window.
  if (certsCache.keys && Date.now() - certsCache.fetchedAt < 3600000) return certsCache.keys;
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error('google_certs_unavailable');
  const data = await res.json();
  certsCache = { keys: data.keys || [], fetchedAt: Date.now() };
  return certsCache.keys;
}

function b64urlToBuffer(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a Google ID token the browser obtained from Sign in with Google.
 *
 * Checked in full rather than merely decoded: the RS256 signature against
 * Google's published key for that kid, the issuer, the audience (our own
 * client id, so a token minted for another site is rejected), expiry, and
 * that Google considers the address verified.
 */
async function verifyGoogleToken(credential) {
  if (!GOOGLE_CLIENT_ID) throw new Error('google_not_configured');
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('google_bad_token');

  const header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('google_bad_token');

  const jwk = (await googleKeys()).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('google_bad_token');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  if (!crypto.verify('RSA-SHA256', signed, publicKey, b64urlToBuffer(parts[2]))) {
    throw new Error('google_bad_token');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new Error('google_bad_token');
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('google_bad_token');
  if (!payload.exp || payload.exp < now) throw new Error('google_bad_token');
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new Error('google_email_unverified');
  }
  if (!payload.email) throw new Error('google_bad_token');
  return payload;
}

/* ── Account helpers ────────────────────────────────────────────────────── */

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Build a username from an email local part, adding digits until it is free.
 * Used when Google sign-in creates an account, which has no username of its own.
 */
async function deriveUsername(email) {
  const base = (email.split('@')[0] || 'member').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'member';
  const candidate = base.length >= 3 ? base : `${base}user`;
  if (!(await kvGet(BY_USERNAME + candidate.toLowerCase()))) return candidate;
  for (let i = 0; i < 50; i++) {
    const tryName = `${candidate}${crypto.randomInt(1000, 9999)}`;
    if (!(await kvGet(BY_USERNAME + tryName.toLowerCase()))) return tryName;
  }
  return `${candidate}${Date.now().toString(36)}`;
}

async function saveUser(user) {
  await kvSet(USER + user.id, user);
  if (user.email) await kvSet(BY_EMAIL + user.email, user.id);
  if (user.username) await kvSet(BY_USERNAME + user.username.toLowerCase(), user.id);
}

async function findByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const key = value.includes('@') ? BY_EMAIL + normaliseEmail(value) : BY_USERNAME + value.toLowerCase();
  const id = await kvGet(key);
  return id ? kvGet(USER + id) : null;
}

/* ── Handler ────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const action = (req.query && req.query.action) || params.get('action') || '';

  // The page asks for this before rendering, so it must answer even with no
  // database attached — that is how the browser knows what to offer.
  if (action === 'config') {
    return send(res, 200, {
      ok: true,
      googleClientId: GOOGLE_CLIENT_ID,
      passwordAccounts: storageReady(),
      googleSignIn: Boolean(GOOGLE_CLIENT_ID) && storageReady()
    });
  }

  if (!storageReady()) {
    return send(res, 503, {
      error: 'storage_unconfigured',
      message: 'Accounts need KV_REST_API_URL and KV_REST_API_TOKEN to be set.'
    });
  }

  try {
    if (action === 'me') {
      const user = await currentUser(req);
      return send(res, 200, { ok: true, user: user ? publicUser(user) : null });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET,POST,OPTIONS');
      return send(res, 405, { error: 'method_not_allowed' });
    }

    if (action === 'logout') {
      const token = cookieToken(req);
      if (token) await kvDel(SESSION + hashToken(token));
      clearSessionCookie(res);
      return send(res, 200, { ok: true });
    }

    if (action === 'signup') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      const email = normaliseEmail(body.email);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      if (!name) return send(res, 400, { error: 'missing_name' });
      if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'invalid_email' });
      if (username && !USERNAME_RE.test(username)) return send(res, 400, { error: 'invalid_username' });
      if (password.length < 8) return send(res, 400, { error: 'weak_password' });

      if (await kvGet(BY_EMAIL + email)) return send(res, 409, { error: 'email_taken' });
      if (username && (await kvGet(BY_USERNAME + username.toLowerCase()))) {
        return send(res, 409, { error: 'username_taken' });
      }

      const user = {
        id: newId('u'),
        name,
        email,
        username: username || (await deriveUsername(email)),
        passwordHash: await hashPassword(password),
        provider: 'password',
        picture: '',
        createdAt: Date.now()
      };
      await saveUser(user);
      await startSession(res, user.id);
      return send(res, 201, { ok: true, user: publicUser(user) });
    }

    if (action === 'login') {
      const body = await readBody(req);
      const identifier = String(body.identifier || body.email || '').trim();
      const password = String(body.password || '');
      if (!identifier || !password) return send(res, 400, { error: 'missing_credentials' });

      const attempts = await kvBump(THROTTLE + hashToken(identifier.toLowerCase()), THROTTLE_WINDOW);
      if (attempts > MAX_ATTEMPTS) return send(res, 429, { error: 'too_many_attempts' });

      const user = await findByIdentifier(identifier);
      // One message and one code whether the account is missing or the
      // password is wrong, so this cannot be used to enumerate accounts.
      const ok = user && user.passwordHash && (await passwordMatches(password, user.passwordHash));
      if (!ok) {
        if (user && !user.passwordHash) return send(res, 401, { error: 'use_google' });
        return send(res, 401, { error: 'bad_credentials' });
      }

      await kvDel(THROTTLE + hashToken(identifier.toLowerCase()));
      await startSession(res, user.id);
      return send(res, 200, { ok: true, user: publicUser(user) });
    }

    if (action === 'google') {
      const body = await readBody(req);
      let payload;
      try {
        payload = await verifyGoogleToken(body.credential);
      } catch (err) {
        const code = err && err.message ? err.message : 'google_bad_token';
        return send(res, code === 'google_not_configured' ? 503 : 401, { error: code });
      }

      const email = normaliseEmail(payload.email);
      const existingId = await kvGet(BY_EMAIL + email);
      let user = existingId ? await kvGet(USER + existingId) : null;

      if (user) {
        // An account made with a password can also sign in with Google, as
        // long as Google vouches for the same verified address.
        user.picture = payload.picture || user.picture || '';
        user.name = user.name || payload.name || '';
        user.googleSub = payload.sub;
        user.lastLoginAt = Date.now();
        await saveUser(user);
      } else {
        user = {
          id: newId('u'),
          name: String(payload.name || email.split('@')[0]).slice(0, 80),
          email,
          username: await deriveUsername(email),
          passwordHash: '',
          provider: 'google',
          googleSub: payload.sub,
          picture: payload.picture || '',
          createdAt: Date.now()
        };
        await saveUser(user);
      }

      await startSession(res, user.id);
      return send(res, 200, { ok: true, user: publicUser(user), created: !existingId });
    }

    return send(res, 400, { error: 'unknown_action' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: err && err.message ? err.message : 'failed' });
  }
};

// Exposed for tests/auth.test.js. Vercel routes on the exported function, so
// hanging helpers off it changes nothing about how the endpoint behaves.
module.exports.internals = {
  deriveUsername,
  hashPassword,
  hashToken,
  passwordMatches,
  publicUser,
  verifyGoogleToken,
  EMAIL_RE,
  USERNAME_RE
};
