// පළමු admin account එක හදන one-time endpoint

import { json, fail } from '../lib/response.js';
import { getOne, insert, run } from '../lib/db.js';
import { hashPassword } from '../lib/crypto.js';
import { isEmail, isPassword, clean } from '../lib/validate.js';
import { rateLimit, clientKey } from '../middleware/rateLimit.js';

// GET /api/setup/status  — admin ඉන්නවද නැද්ද බලන්න
export async function getStatus(request, env) {
  try {
    const existing = await getOne(env, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    return json({ ok: true, has_admin: !!existing });
  } catch (err) {
    return json({ ok: false, has_admin: false, error: err.message }, { status: 500 });
  }
}

// POST /api/setup/admin
export async function createAdmin(request, env) {
  try {
    const rl = await rateLimit(env, 'AUTH_LIMITER', `setup:${clientKey(request)}`);
    if (!rl.success) return fail('Too many attempts', 429);

    let body;
    try {
      body = await request.json();
    } catch {
      return fail('Invalid JSON');
    }

    const token = clean(body.setup_token);
    const email = clean(body.email).toLowerCase();
    const password = body.password;
    const name = clean(body.name) || 'Admin';

    if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32) {
      return fail('Authentication is not configured', 503);
    }
    if (!env.SETUP_TOKEN) return fail('Setup is disabled', 503);
    if (token !== env.SETUP_TOKEN) return fail('Invalid setup token', 403);
    if (!isEmail(email)) return fail('Invalid email');
    if (!isPassword(password)) return fail('Password must be at least 8 characters');

    // ─── 1. දැනටමත් admin කෙනෙක් ඉන්නවද? ─────────
    const existingAdmin = await getOne(env, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existingAdmin) {
      return fail('An admin already exists. Please log in at /admin/login.html', 409);
    }

    // ─── 2. මේ email එකෙන් user කෙනෙක් ඉන්නවද? ─────
    //     ඉන්නවා නම් ඒක admin එකට upgrade කරනවා
    //     (delete කරනවා වෙනුවට — ආරක්ෂිතයි)
    const existingUser = await getOne(
      env,
      'SELECT id FROM users WHERE email = ?',
      email
    );

    let userId;
    const hash = await hashPassword(password, env.PEPPER || '');

    if (existingUser) {
      // දැනට තියෙන user එක admin එකට upgrade කරනවා
      userId = existingUser.id;
      await run(
        env,
        'UPDATE users SET password_hash = ?, name = ?, role = ?, updated_at = ? WHERE id = ?',
        hash,
        name,
        'admin',
        new Date().toISOString(),
        userId
      );
    } else {
      // අලුත් user + admin
      userId = await insert(
        env,
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
        email,
        hash,
        name,
        'admin'
      );
    }

    if (!userId) {
      return fail('Failed to create user record', 500);
    }

    // ─── 3. admins table එකට add කරනවා (ඉන්නවා නම් skip) ─────
    const existingAdminRow = await getOne(
      env,
      'SELECT id FROM admins WHERE user_id = ?',
      userId
    );
    if (!existingAdminRow) {
      await run(env, 'INSERT INTO admins (user_id) VALUES (?)', userId);
    }

    return json({
      ok: true,
      message: 'Admin created. You can now log in at /admin/login.html',
    });
  } catch (err) {
    // ─── හරියටම මොකද වුණේ කියලා log කරනවා ─────
    console.error('Setup error:', err);
    return json(
      {
        ok: false,
        error: err.message || 'Setup failed',
        // Development එකේදී stack trace පෙන්වනවා, production එකේ නෑ
        stack: env.ENVIRONMENT === 'production' ? undefined : err.stack,
      },
      { status: 500 }
    );
  }
}