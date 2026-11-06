import { ok, fail } from '../lib/response.js';
import { getOne, run } from '../lib/db.js';
import { requireAdmin, requireCSRF } from '../middleware/auth.js';

// GET /api/settings  (admin only)
export async function getSettings(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await env.DB.prepare('SELECT key, value, is_secret FROM settings').all();

  const settings = {};
  for (const row of rows.results) {
    if (row.is_secret && row.value) {
      settings[row.key] = {
        set: true,
        masked: '••••••' + String(row.value).slice(-4),
      };
    } else {
      settings[row.key] = { set: !!row.value, value: row.value };
    }
  }
  return ok({ settings });
}

// POST /api/settings  (admin only)
export async function updateSettings(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const allowed = ['tmdb_api_key', 'tmdb_language', 'site_name', 'site_tagline', 'allow_registration'];

  for (const [key, rawValue] of Object.entries(body)) {
    if (!allowed.includes(key)) continue;

    const existing = await getOne(env, 'SELECT is_secret FROM settings WHERE key = ?', key);
    const isSecret = existing?.is_secret ? 1 : 0;

    // Secret setting + empty value = overwrite කරන්න එපා
    if (isSecret && !rawValue) continue;

    await run(
      env,
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      String(rawValue),
      isSecret,
      new Date().toISOString()
    );
  }

  return ok({ message: 'Settings saved' });
}