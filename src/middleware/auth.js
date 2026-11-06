import { getCookie, fail } from '../lib/response.js';
import { verifyJWT } from '../lib/crypto.js';
import { getOne } from '../lib/db.js';

export async function getSession(request, env) {
  const token = getCookie(request, 'tipiz_session');
  if (!token) return null;
  return await verifyJWT(token, env.JWT_SECRET);
}

export async function requireUser(request, env) {
  const session = await getSession(request, env);
  if (!session) return { error: fail('Authentication required', 401) };

  const user = await getOne(
    env,
    'SELECT id, email, name, role, created_at FROM users WHERE id = ?',
    session.sub
  );
  if (!user) return { error: fail('User not found', 401) };
  return { user, session };
}

export async function requireAdmin(request, env) {
  const res = await requireUser(request, env);
  if (res.error) return res;
  if (res.user.role !== 'admin') return { error: fail('Admin access required', 403) };
  return res;
}

export async function requireCSRF(request) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const cookie = getCookie(request, 'tipiz_csrf');
  const header = request.headers.get('X-CSRF-Token');
  if (!cookie || !header || cookie !== header) {
    return fail('Invalid CSRF token', 403);
  }
  return null;
}