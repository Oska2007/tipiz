import { ok, fail } from '../lib/response.js';
import { insert } from '../lib/db.js';

export async function syncVideo(request, env) {
  // API Key එක චෙක් කරන්න (ආරක්ෂාවට)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.VPS_API_KEY}`) {
    return fail('Unauthorized', 401);
  }

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { uuid, title, r2_key, telegram_file_id, source_type } = body;

  if (!uuid || !title) return fail('Missing uuid or title');

  try {
    await insert(
      env,
      `INSERT INTO video_sources (id, title, r2_key, telegram_file_id, source_type)
       VALUES (?, ?, ?, ?, ?)`,
      uuid, title, r2_key || null, telegram_file_id || null, source_type || 'r2'
    );
    return ok({ message: 'Video synced to Database' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return ok({ message: 'Video already synced' });
    return fail(err.message, 500);
  }
}

export async function assignVideoSource(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.VPS_API_KEY}`) {
    return fail('Unauthorized', 401);
  }

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { video_source_id, type, target_id } = body;
  if (!video_source_id || !type || !target_id) return fail('Missing fields');

  const videoSource = await env.DB.prepare('SELECT id FROM video_sources WHERE id = ?').bind(video_source_id).first();
  if (!videoSource) return fail('Video source not found');

  if (type === 'movie') {
    await env.DB.prepare('UPDATE movies SET video_source_id = ?, updated_at = ? WHERE id = ?')
      .bind(video_source_id, new Date().toISOString(), target_id).run();
  } else if (type === 'episode') {
    await env.DB.prepare('UPDATE episodes SET video_source_id = ? WHERE id = ?')
      .bind(video_source_id, target_id).run();
  } else {
    return fail('Invalid type');
  }

  return ok({ message: `Video source assigned to ${type}` });
}

// GET /api/vps/videos
export async function listVideoSources(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.VPS_API_KEY}`) return fail('Unauthorized', 401);

  const rows = await getAll(env, 'SELECT id, title, created_at FROM video_sources ORDER BY created_at DESC LIMIT 50');
  return ok({ results: rows });
}

export async function backupDatabase(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.VPS_API_KEY}`) return fail('Unauthorized', 401);

  try {
    const tables = ['users', 'movies', 'tv_series', 'seasons', 'episodes', 'video_sources', 'settings'];
    const backup = {};
    
    for (const table of tables) {
      const res = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      backup[table] = res.results;
    }

    return new Response(JSON.stringify(backup, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="tipiz-backup.json"'
      }
    });
  } catch (err) {
    return fail('Backup failed: ' + err.message, 500);
  }
}