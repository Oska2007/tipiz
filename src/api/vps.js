import { ok, fail } from '../lib/response.js';
import { getAll, insert } from '../lib/db.js';

function isAuthorized(request, env) {
  const key = env.VPS_API_KEY;
  return Boolean(key && request.headers.get('Authorization') === `Bearer ${key}`);
}

export async function syncVideo(request, env) {
  if (!isAuthorized(request, env)) {
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
  if (!isAuthorized(request, env)) {
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
  if (!isAuthorized(request, env)) return fail('Unauthorized', 401);

  const rows = await getAll(env, 'SELECT id, title, created_at FROM video_sources ORDER BY created_at DESC LIMIT 50');
  return ok({ results: rows });
}

export async function backupDatabase(request, env) {
  if (!isAuthorized(request, env)) return fail('Unauthorized', 401);

  try {
    const [
      users,
      movies,
      tvSeries,
      seasons,
      episodes,
      videoSources,
      settings,
    ] = await Promise.all([
      env.DB.prepare(
        'SELECT id, email, name, role, email_verified, created_at, updated_at FROM users'
      ).all(),
      env.DB.prepare('SELECT * FROM movies').all(),
      env.DB.prepare('SELECT * FROM tv_series').all(),
      env.DB.prepare('SELECT * FROM seasons').all(),
      env.DB.prepare('SELECT * FROM episodes').all(),
      env.DB.prepare('SELECT * FROM video_sources').all(),
      env.DB.prepare('SELECT key, value, is_secret, updated_at FROM settings WHERE is_secret = 0').all(),
    ]);

    const backup = {
      users: users.results,
      movies: movies.results,
      tv_series: tvSeries.results,
      seasons: seasons.results,
      episodes: episodes.results,
      video_sources: videoSources.results,
      settings: settings.results,
    };

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