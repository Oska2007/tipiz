import { ok, fail } from '../lib/response.js';
import { getOne, getAll, insert, run } from '../lib/db.js';
import { requireAdmin, requireCSRF } from '../middleware/auth.js';
import * as tmdb from '../lib/tmdb.js';

// ── Frontend එකට අවශ්‍ය විදිහට දත්ත හදන function එක ──
function decorateTV(s) {
  return {
    ...s,
    title: s.name, // Frontend එකේ Card එකට title ඕන නිසා
    release_date: s.first_air_date, // Frontend එකට year එක ඕන නිසා
    media_type: 'tv',
    poster_url: tmdb.posterUrl(s.poster_path),
    backdrop_url: tmdb.backdropUrl(s.backdrop_path),
  };
}

// GET /api/tv  (public)
export async function listPublic(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
  const offset = (page - 1) * limit;

  const rows = await getAll(env,
    `SELECT id, tmdb_id, name, overview, poster_path, backdrop_path,
            first_air_date, number_of_seasons, vote_average
     FROM tv_series WHERE status = 'published'
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
  const total = await getOne(env, "SELECT COUNT(*) as c FROM tv_series WHERE status = 'published'");

  return ok({
    results: rows.map(decorateTV),
    page, limit,
    total: total?.c || 0,
    total_pages: Math.ceil((total?.c || 0) / limit),
  });
}

// GET /api/tv/:id  (public)
export async function getPublic(request, env, id) {
  const series = await getOne(
    env, `SELECT * FROM tv_series WHERE id = ? AND status = 'published'`, id
  );
  if (!series) return fail('Series not found', 404);

  try { series.genres = JSON.parse(series.genres_json || '[]'); } catch { series.genres = []; }
  try { series.cast = JSON.parse(series.cast_json || '[]'); } catch { series.cast = []; }
  delete series.genres_json;
  delete series.cast_json;

  series.poster_url = tmdb.posterUrl(series.poster_path);
  series.backdrop_url = tmdb.backdropUrl(series.backdrop_path);
  series.cast = series.cast.map((c) => ({
    ...c,
    profile_url: tmdb.profileUrl(c.profile_path),
  }));

  series.seasons = await getAll(env,
    `SELECT id, season_number, name, overview, poster_path, air_date
     FROM seasons WHERE series_id = ? ORDER BY season_number ASC`,
    id
  );

  return ok({ series });
}

// POST /api/tv/import  (admin)
export async function importFromTMDB(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  if (!body.tmdb_id) return fail('tmdb_id required');

  let data;
  try { data = await tmdb.getTVDetails(env, body.tmdb_id); }
  catch (err) { return fail(err.message, 500); }

  const genres = tmdb.extractGenres(data.genres);
  const cast = tmdb.extractCast(data.credits, 10);
  const trailer = tmdb.extractTrailer(data.videos);

  const existing = await getOne(env, 'SELECT id FROM tv_series WHERE tmdb_id = ?', data.id);

  let seriesId;
  if (existing) {
    seriesId = existing.id;
    await run(
      env,
      `UPDATE tv_series SET name=?, original_name=?, overview=?, poster_path=?, backdrop_path=?,
        first_air_date=?, number_of_seasons=?, vote_average=?, trailer_key=?, genres_json=?,
        cast_json=?, updated_at=? WHERE id=?`,
      data.name,
      data.original_name || data.name,
      data.overview || '',
      data.poster_path,
      data.backdrop_path,
      data.first_air_date,
      data.number_of_seasons || 0,
      data.vote_average || 0,
      trailer,
      JSON.stringify(genres),
      JSON.stringify(cast),
      new Date().toISOString(),
      seriesId
    );
  } else {
    seriesId = await insert(
      env,
      `INSERT INTO tv_series
        (tmdb_id, name, original_name, overview, poster_path, backdrop_path,
         first_air_date, number_of_seasons, vote_average, trailer_key, genres_json, cast_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      data.id,
      data.name,
      data.original_name || data.name,
      data.overview || '',
      data.poster_path,
      data.backdrop_path,
      data.first_air_date,
      data.number_of_seasons || 0,
      data.vote_average || 0,
      trailer,
      JSON.stringify(genres),
      JSON.stringify(cast)
    );
  }

  // Seasons import
  let seasonsImported = 0;
  for (const s of data.seasons || []) {
    if (s.season_number === 0) continue; // specials skip
    const existingSeason = await getOne(
      env, 'SELECT id FROM seasons WHERE series_id = ? AND season_number = ?',
      seriesId, s.season_number
    );
    if (!existingSeason) {
      await insert(
        env,
        `INSERT INTO seasons (series_id, season_number, name, overview, poster_path, air_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        seriesId, s.season_number, s.name || '', s.overview || '', s.poster_path, s.air_date
      );
      seasonsImported++;
    }
  }

  return ok({
    id: seriesId,
    message: existing
      ? `Series updated. ${seasonsImported} new seasons added.`
      : `Series imported as draft. ${seasonsImported} seasons added.`,
    updated: !!existing,
    seasons_imported: seasonsImported,
  });
}

// POST /api/tv/:id/import-season  (admin)
export async function importSeason(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  const seasonNumber = parseInt(body.season_number, 10);
  if (!seasonNumber && seasonNumber !== 0) return fail('season_number required');

  const series = await getOne(env, 'SELECT * FROM tv_series WHERE id = ?', id);
  if (!series) return fail('Series not found', 404);

  let seasonData;
  try { seasonData = await tmdb.getTVSeason(env, series.tmdb_id, seasonNumber); }
  catch (err) { return fail(err.message, 500); }

  let seasonRow = await getOne(
    env, 'SELECT id FROM seasons WHERE series_id = ? AND season_number = ?', id, seasonNumber
  );
  let seasonId;
  if (!seasonRow) {
    seasonId = await insert(
      env,
      `INSERT INTO seasons (series_id, season_number, name, overview, poster_path, air_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, seasonNumber, seasonData.name || '', seasonData.overview || '',
      seasonData.poster_path, seasonData.air_date
    );
  } else {
    seasonId = seasonRow.id;
  }

  let episodesImported = 0;
  for (const ep of seasonData.episodes || []) {
    const exists = await getOne(
      env, 'SELECT id FROM episodes WHERE season_id = ? AND episode_number = ?',
      seasonId, ep.episode_number
    );
    if (!exists) {
      await insert(
        env,
        `INSERT INTO episodes
          (series_id, season_id, episode_number, name, overview, still_path, air_date, runtime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, seasonId, ep.episode_number, ep.name || '', ep.overview || '',
        ep.still_path, ep.air_date, ep.runtime || 0
      );
      episodesImported++;
    }
  }

  return ok({ season_id: seasonId, episodes_imported: episodesImported });
}

// PATCH /api/tv/:id/status  (admin)
export async function setStatus(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  const status = body.status === 'published' ? 'published' : 'draft';

  await run(env, 'UPDATE tv_series SET status=?, updated_at=? WHERE id=?',
    status, new Date().toISOString(), id);

  return ok({ message: `Series ${status}` });
}

// GET /api/tv/:id/episodes
export async function listEpisodes(request, env, id) {
  const url = new URL(request.url);
  const season = url.searchParams.get('season');

  const series = await getOne(env, 'SELECT id, status FROM tv_series WHERE id = ?', id);
  if (!series) return fail('Series not found', 404);

  let rows;
  if (season) {
    const seasonRow = await getOne(
      env, 'SELECT id FROM seasons WHERE series_id = ? AND season_number = ?', id, season
    );
    if (!seasonRow) return ok({ episodes: [] });
    rows = await getAll(env,
      `SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number ASC`,
      seasonRow.id
    );
  } else {
    rows = await getAll(env,
      `SELECT * FROM episodes WHERE series_id = ? ORDER BY season_id ASC, episode_number ASC`,
      id
    );
  }

  const episodes = rows.map((e) => ({
    ...e,
    still_url: tmdb.stillUrl(e.still_path),
  }));

  return ok({ episodes });
}

// DELETE /api/tv/:id  (admin)
export async function deleteTV(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  await run(env, 'DELETE FROM tv_series WHERE id = ?', id);
  return ok({ message: 'Series deleted' });
}

// POST /api/admin/tv/publish-drafts  (admin)
export async function publishAllDrafts(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  const result = await run(
    env,
    "UPDATE tv_series SET status='published', updated_at=? WHERE status='draft'",
    new Date().toISOString()
  );
  return ok({
    message: 'All draft series published',
    count: result.meta?.changes || 0,
  });
}

// GET /api/admin/tv  (admin)
export async function listAdmin(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));
  const offset = (page - 1) * limit;

  const rows = await getAll(env,
    `SELECT id, tmdb_id, name, poster_path, first_air_date, number_of_seasons,
            vote_average, status, created_at
     FROM tv_series ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
  const total = await getOne(env, 'SELECT COUNT(*) as c FROM tv_series');

  return ok({
    results: rows.map(decorateTV),
    page, limit,
    total: total?.c || 0,
    total_pages: Math.ceil((total?.c || 0) / limit),
  });
}

// GET /api/admin/tv/:id  (admin - drafts ඇතුළුව)
export async function getAdminSeries(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const series = await getOne(env, 'SELECT * FROM tv_series WHERE id = ?', id);
  if (!series) return fail('Series not found', 404);

  series.seasons = await getAll(env,
    `SELECT id, season_number, name FROM seasons WHERE series_id = ? ORDER BY season_number ASC`,
    id
  );

  return ok({ series });
}