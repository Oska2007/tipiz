import { ok, fail } from '../lib/response.js';
import { getOne, getAll, insert, run } from '../lib/db.js';
import { requireAdmin, requireCSRF } from '../middleware/auth.js';
import * as tmdb from '../lib/tmdb.js';

function decorateMovie(m) {
  return {
    ...m,
    poster_url: tmdb.posterUrl(m.poster_path),
    backdrop_url: tmdb.backdropUrl(m.backdrop_path),
  };
}

// GET /api/movies  (public)
export async function listPublic(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
  const offset = (page - 1) * limit;
  const year = url.searchParams.get('year');
  const sort = url.searchParams.get('sort') || 'recent';

  let where = "status = 'published'";
  const params = [];
  if (year) { where += " AND substr(release_date, 1, 4) = ?"; params.push(String(year)); }

  const orderBy =
    sort === 'top'     ? 'vote_average DESC' :
    sort === 'popular' ? 'vote_average DESC' :
    'created_at DESC';

  const rows = await getAll(
    env,
    `SELECT id, tmdb_id, title, overview, poster_path, backdrop_path,
            release_date, runtime, vote_average, original_language
     FROM movies WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  const total = await getOne(env, `SELECT COUNT(*) as c FROM movies WHERE ${where}`, ...params);

  return ok({
    results: rows.map(decorateMovie),
    page, limit,
    total: total?.c || 0,
    total_pages: Math.ceil((total?.c || 0) / limit),
  });
}

// GET /api/movies/:id  (public)
export async function getPublic(request, env, id) {
  const movie = await getOne(
    env, `SELECT * FROM movies WHERE id = ? AND status = 'published'`, id
  );
  if (!movie) return fail('Movie not found', 404);

  try { movie.genres = JSON.parse(movie.genres_json || '[]'); } catch { movie.genres = []; }
  try { movie.cast = JSON.parse(movie.cast_json || '[]'); } catch { movie.cast = []; }
  delete movie.genres_json;
  delete movie.cast_json;

  movie.poster_url = tmdb.posterUrl(movie.poster_path);
  movie.backdrop_url = tmdb.backdropUrl(movie.backdrop_path);
  movie.cast = movie.cast.map((c) => ({
    ...c,
    profile_url: tmdb.profileUrl(c.profile_path),
  }));

  // ── වීඩියෝ එක තියෙනවද බලන කොටස ──
  if (movie.video_id) {
    movie.video = await getOne(
      env, `SELECT id, kind, duration_seconds FROM videos WHERE id = ?`, movie.video_id
    );
  } else if (movie.video_source_id) {
    // අලුත් VPS Permanent ID එක තියෙනවා නම්
    const vs = await getOne(env, `SELECT id, source_type FROM video_sources WHERE id = ?`, movie.video_source_id);
    if (vs) {
      movie.video = { id: vs.id, kind: 'mp4', duration_seconds: 0 };
    }
  }

  return ok({ movie });
}

// POST /api/movies/import  (admin)
export async function importFromTMDB(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  if (!body.tmdb_id) return fail('tmdb_id required');

  let data;
  try { data = await tmdb.getMovieDetails(env, body.tmdb_id); }
  catch (err) { return fail(err.message, 500); }

  const originalLanguage =
    typeof data.original_language === 'string'
      ? data.original_language.trim().toLowerCase()
      : null;
  const genres = tmdb.extractGenres(data.genres);
  const cast = tmdb.extractCast(data.credits, 10);
  const trailer = tmdb.extractTrailer(data.videos);

  const existing = await getOne(env, 'SELECT id FROM movies WHERE tmdb_id = ?', data.id);

  if (existing) {
    await run(
      env,
      `UPDATE movies SET title=?, original_title=?, original_language=?, overview=?, poster_path=?, backdrop_path=?,
        release_date=?, runtime=?, vote_average=?, trailer_key=?, genres_json=?, cast_json=?,
        updated_at=? WHERE id=?`,
      data.title,
      data.original_title || data.title,
      originalLanguage,
      data.overview || '',
      data.poster_path,
      data.backdrop_path,
      data.release_date,
      data.runtime || 0,
      data.vote_average || 0,
      trailer,
      JSON.stringify(genres),
      JSON.stringify(cast),
      new Date().toISOString(),
      existing.id
    );
    return ok({ id: existing.id, message: 'Movie updated from TMDB', updated: true });
  }

  const id = await insert(
    env,
    `INSERT INTO movies
      (tmdb_id, title, original_title, original_language, overview, poster_path, backdrop_path,
       release_date, runtime, vote_average, trailer_key, genres_json, cast_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    data.id,
    data.title,
    data.original_title || data.title,
    originalLanguage,
    data.overview || '',
    data.poster_path,
    data.backdrop_path,
    data.release_date,
    data.runtime || 0,
    data.vote_average || 0,
    trailer,
    JSON.stringify(genres),
    JSON.stringify(cast)
  );

  return ok({ id, message: 'Movie imported as draft. Publish when ready.' });
}

// PATCH /api/movies/:id/status  (admin)
export async function setStatus(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const status = body.status === 'published' ? 'published' : 'draft';
  await run(env, 'UPDATE movies SET status=?, updated_at=? WHERE id=?',
    status, new Date().toISOString(), id);

  return ok({ message: `Movie ${status}` });
}

// GET /api/admin/movies  (admin)
export async function listAdmin(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
  const offset = (page - 1) * limit;

  const rows = await getAll(env,
    `SELECT id, tmdb_id, title, poster_path, release_date, vote_average, status, created_at
     FROM movies ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
  const total = await getOne(env, 'SELECT COUNT(*) as c FROM movies');

  return ok({
    results: rows.map(decorateMovie),
    page, limit,
    total: total?.c || 0,
    total_pages: Math.ceil((total?.c || 0) / limit),
  });
}

// GET /api/movies/:id/similar
export async function getSimilar(request, env, id) {
  const movie = await getOne(env, 'SELECT id, genres_json FROM movies WHERE id = ?', id);
  if (!movie) return fail('Movie not found', 404);

  let genres = [];
  try { genres = JSON.parse(movie.genres_json || '[]'); } catch {}

  let rows = [];

  if (genres.length) {
    const conditions = genres.map(() => 'genres_json LIKE ?').join(' OR ');
    const params = genres.map((g) => `%"id":${g.id},"name"%`);
    rows = await getAll(
      env,
      `SELECT id, tmdb_id, title, poster_path, release_date, vote_average
       FROM movies WHERE id != ? AND status='published' AND (${conditions})
       ORDER BY vote_average DESC LIMIT 12`,
      id, ...params
    );
  }

  if (rows.length < 4) {
    const excludeIds = [id, ...rows.map((r) => r.id)];
    const placeholders = excludeIds.map(() => '?').join(',');
    const extra = await getAll(
      env,
      `SELECT id, tmdb_id, title, poster_path, release_date, vote_average
       FROM movies WHERE status='published' AND id NOT IN (${placeholders})
       ORDER BY vote_average DESC LIMIT ?`,
      ...excludeIds, 12 - rows.length
    );
    rows = [...rows, ...extra];
  }

  return ok({
    results: rows.map((r) => ({
      ...r,
      media_type: 'movie',
      poster_url: tmdb.posterUrl(r.poster_path),
    })),
  });
}

// DELETE /api/movies/:id  (admin)
export async function deleteMovie(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  await run(env, 'DELETE FROM movies WHERE id = ?', id);
  return ok({ message: 'Movie deleted' });
}

// POST /api/admin/movies/publish-drafts  (admin)
export async function publishAllDrafts(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  const result = await run(
    env,
    "UPDATE movies SET status='published', updated_at=? WHERE status='draft'",
    new Date().toISOString()
  );
  return ok({
    message: 'All draft movies published',
    count: result.meta?.changes || 0,
  });
}