import { ok, fail } from '../lib/response.js';
import { getOne, getAll, run } from '../lib/db.js';
import { requireUser, requireCSRF } from '../middleware/auth.js';
import * as tmdb from '../lib/tmdb.js';

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'title';
}

// ── 1. Dashboard Data (Counts) ──
export async function getDashboardStats(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const [watchlist, favorites, history] = await Promise.all([
    getOne(env, 'SELECT COUNT(*) as c FROM watchlist WHERE user_id = ?', auth.user.id),
    getOne(env, 'SELECT COUNT(*) as c FROM favorites WHERE user_id = ?', auth.user.id),
    getOne(env, 'SELECT COUNT(*) as c FROM watch_history WHERE user_id = ?', auth.user.id),
  ]);

  return ok({
    stats: {
      watchlist: watchlist?.c || 0,
      favorites: favorites?.c || 0,
      watched: history?.c || 0,
    }
  });
}

// ── 2. Watchlist ──
export async function getWatchlist(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const rows = await getAll(
    env,
    `SELECT w.media_type, w.media_id, w.created_at,
       m.title as m_title, m.poster_path as m_poster, m.release_date,
       t.name as t_title, t.poster_path as t_poster, t.first_air_date
     FROM watchlist w
     LEFT JOIN movies m ON w.media_type = 'movie' AND w.media_id = m.id
     LEFT JOIN tv_series t ON w.media_type = 'tv' AND w.media_id = t.id
     WHERE w.user_id = ? ORDER BY w.created_at DESC`,
    auth.user.id
  );

  return ok({
    results: rows.map(r => ({
      media_type: r.media_type,
      id: r.media_id,
      title: r.media_type === 'movie' ? r.m_title : r.t_title,
      poster_path: r.media_type === 'movie' ? r.m_poster : r.t_poster,
      release_date: r.media_type === 'movie' ? r.release_date : r.first_air_date,
      poster_url: tmdb.posterUrl(r.media_type === 'movie' ? r.m_poster : r.t_poster),
    }))
  });
}

// ── 3. Favorites ──
export async function getFavorites(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const rows = await getAll(
    env,
    `SELECT f.media_type, f.media_id, f.created_at,
       m.title as m_title, m.poster_path as m_poster, m.release_date,
       t.name as t_title, t.poster_path as t_poster, t.first_air_date
     FROM favorites f
     LEFT JOIN movies m ON f.media_type = 'movie' AND f.media_id = m.id
     LEFT JOIN tv_series t ON f.media_type = 'tv' AND f.media_id = t.id
     WHERE f.user_id = ? ORDER BY f.created_at DESC`,
    auth.user.id
  );

  return ok({
    results: rows.map(r => ({
      media_type: r.media_type,
      id: r.media_id,
      title: r.media_type === 'movie' ? r.m_title : r.t_title,
      poster_path: r.media_type === 'movie' ? r.m_poster : r.t_poster,
      release_date: r.media_type === 'movie' ? r.release_date : r.first_air_date,
      poster_url: tmdb.posterUrl(r.media_type === 'movie' ? r.m_poster : r.t_poster),
    }))
  });
}

// ── 4. Toggle Watchlist / Favorites ──
export async function toggleList(request, env, type) { // type = 'watchlist' හෝ 'favorites'
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  const { media_type, media_id } = body;

  if (!media_type || !media_id) return fail('Missing media_type or media_id');

  const existing = await getOne(
    env,
    `SELECT id FROM ${type} WHERE user_id = ? AND media_type = ? AND media_id = ?`,
    auth.user.id, media_type, media_id
  );

  if (existing) {
    await run(env, `DELETE FROM ${type} WHERE id = ?`, existing.id);
    return ok({ status: 'removed' });
  } else {
    await run(
      env,
      `INSERT INTO ${type} (user_id, media_type, media_id) VALUES (?, ?, ?)`,
      auth.user.id, media_type, media_id
    );
    return ok({ status: 'added' });
  }
}

// ── 5. Check Status (Movie page එකේ බටන් හරිද බලන්න) ──
export async function checkStatus(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const media_type = url.searchParams.get('type');
  const media_id = url.searchParams.get('id');

  if (!media_type || !media_id) return fail('Missing parameters');

  const inWatchlist = await getOne(env, 'SELECT id FROM watchlist WHERE user_id=? AND media_type=? AND media_id=?', auth.user.id, media_type, media_id);
  const inFav = await getOne(env, 'SELECT id FROM favorites WHERE user_id=? AND media_type=? AND media_id=?', auth.user.id, media_type, media_id);

  return ok({
    in_watchlist: !!inWatchlist,
    in_favorites: !!inFav
  });
}

// ── 6. Continue Watching & History ──
export async function getHistory(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'continue'; // 'continue' හෝ 'recent'

  // completed = 0 (අඩකින් නැවැත්තුව) හෝ completed = 1 (ඉවර වුණ)
  const condition = mode === 'continue' ? 'h.completed = 0 AND h.position_seconds > 10' : '1=1';

  const rows = await getAll(
    env,
    `SELECT h.*, 
       m.title as m_title, m.poster_path as m_poster, m.backdrop_path as m_backdrop,
       e.name as e_title, e.still_path as e_still, e.season_id,
       s.season_number,
       t.name as t_title, t.poster_path as t_poster, t.backdrop_path as t_backdrop
     FROM watch_history h
     LEFT JOIN movies m ON h.media_type = 'movie' AND h.media_id = m.id
     LEFT JOIN episodes e ON h.media_type = 'episode' AND h.media_id = e.id
     LEFT JOIN seasons s ON e.season_id = s.id
     LEFT JOIN tv_series t ON h.series_id = t.id
     WHERE h.user_id = ? AND ${condition}
     ORDER BY h.updated_at DESC LIMIT 20`,
    auth.user.id
  );

  return ok({
    results: rows.map(r => {
      const isMovie = r.media_type === 'movie';
      return {
        media_type: r.media_type,
        media_id: r.media_id,
        series_id: r.series_id,
        title: isMovie ? r.m_title : r.t_title,
        subtitle: isMovie ? '' : `S${r.season_number} E${r.episode_number}: ${r.e_title}`,
        backdrop_url: tmdb.backdropUrl(isMovie ? r.m_backdrop : r.t_backdrop),
        poster_url: tmdb.posterUrl(isMovie ? r.m_poster : r.t_poster),
        position_seconds: r.position_seconds,
        duration_seconds: r.duration_seconds,
        progress_percent: r.duration_seconds ? Math.round((r.position_seconds / r.duration_seconds) * 100) : 0,
        completed: r.completed,
        watch_url: isMovie ? `/watch.html?type=movie&id=${r.media_id}` : `/watch.html?type=episode&id=${r.media_id}`,
        details_url: isMovie
          ? `/movie/${slugify(r.m_title)}-${encodeURIComponent(r.media_id)}`
          : `/tv/${slugify(r.t_title)}-${encodeURIComponent(r.series_id)}`
      };
    })
  });
}