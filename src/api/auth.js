import { ok, fail, json, setCookie, clearCookie } from '../lib/response.js';
import { getOne, insert, run } from '../lib/db.js';
import { hashPassword, verifyPassword, signJWT, randomToken } from '../lib/crypto.js';
import { isEmail, isPassword, isName, clean } from '../lib/validate.js';
import { requireUser, requireCSRF } from '../middleware/auth.js';
import { rateLimit, clientKey } from '../middleware/rateLimit.js';

const SESSION_DAYS = 7;

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    created_at: user.created_at,
  };
}

async function setSessionCookies(response, user, env) {
  const jwt = await signJWT(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    SESSION_DAYS * 86400
  );
  const csrf = randomToken(24);

  setCookie(response, 'tipiz_session', jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 86400,
  });
  setCookie(response, 'tipiz_csrf', csrf, {
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 86400,
  });
  return response;
}

// ── POST /api/auth/register ─────────────────────
export async function register(request, env) {
  const rl = await rateLimit(env, 'AUTH_LIMITER', `reg:${clientKey(request)}`);
  if (!rl.success) return fail('Too many attempts. Try again later.', 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON');
  }

  const email = clean(body.email).toLowerCase();
  const password = body.password;
  const name = clean(body.name) || email.split('@')[0];

  if (!isEmail(email)) return fail('Invalid email address');
  if (!isPassword(password)) return fail('Password must be at least 8 characters');
  if (!isName(name)) return fail('Invalid name');

  const exists = await getOne(env, 'SELECT id FROM users WHERE email = ?', email);
  if (exists) return fail('Email already registered', 409);

  const hash = await hashPassword(password, env.PEPPER || '');
  const userId = await insert(
    env,
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
    email,
    hash,
    name
  );
  if (!userId) return fail('Registration failed', 500);

  const user = await getOne(
    env,
    'SELECT id, email, name, role, created_at FROM users WHERE id = ?',
    userId
  );
  const res = json({ ok: true, user: publicUser(user) });
  return setSessionCookies(res, user, env);
}

// ── POST /api/auth/login ────────────────────────
export async function login(request, env) {
  const rl = await rateLimit(env, 'AUTH_LIMITER', `login:${clientKey(request)}`);
  if (!rl.success) return fail('Too many login attempts. Try again in 1 minute.', 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON');
  }

  const email = clean(body.email).toLowerCase();
  const password = body.password || '';

  if (!isEmail(email) || !password) return fail('Invalid email or password', 401);

  const user = await getOne(
    env,
    'SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = ?',
    email
  );
  if (!user) return fail('Invalid email or password', 401);

  const valid = await verifyPassword(password, user.password_hash, env.PEPPER || '');
  if (!valid) return fail('Invalid email or password', 401);

  const res = json({ ok: true, user: publicUser(user) });
  return setSessionCookies(res, user, env);
}

// ── POST /api/auth/logout ───────────────────────
export async function logout(request, env) {
  const res = json({ ok: true });
  clearCookie(res, 'tipiz_session');
  clearCookie(res, 'tipiz_csrf');
  return res;
}

// ── GET /api/auth/me ────────────────────────────
export async function me(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  return ok({ user: publicUser(auth.user) });
}

// ── POST /api/auth/change-password ──────────────
export async function changePassword(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON');
  }

  const current = body.current_password || '';
  const next = body.new_password;

  if (!isPassword(next)) return fail('New password must be at least 8 characters');

  const full = await getOne(env, 'SELECT password_hash FROM users WHERE id = ?', auth.user.id);
  if (!full) return fail('User not found', 404);

  const valid = await verifyPassword(current, full.password_hash, env.PEPPER || '');
  if (!valid) return fail('Current password is incorrect', 401);

  const hash = await hashPassword(next, env.PEPPER || '');
  await run(
    env,
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hash,
    new Date().toISOString(),
    auth.user.id
  );

  return ok({ message: 'Password changed successfully' });
}