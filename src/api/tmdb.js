import { ok, fail } from '../lib/response.js';
import { requireAdmin } from '../middleware/auth.js';
import * as tmdb from '../lib/tmdb.js';

// GET /api/tmdb/search?q=...&type=movie|tv&page=1
export async function search(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const type = url.searchParams.get('type') || 'movie';
  const page = parseInt(url.searchParams.get('page') || '1', 10);

  if (!q) return fail('Query required');

  try {
    const data = type === 'tv'
      ? await tmdb.searchTV(env, q, page)
      : await tmdb.searchMovies(env, q, page);

    // Return එකට thumbnail URLs එකතු කරනවා
    const results = (data.results || []).map((r) => ({
      ...r,
      poster_url: tmdb.posterUrl(r.poster_path, 'w342'),
      backdrop_url: tmdb.backdropUrl(r.backdrop_path, 'w780'),
    }));

    return ok({
      results,
      page: data.page || 1,
      total_pages: data.total_pages || 0,
      total_results: data.total_results || 0,
    });
  } catch (err) {
    return fail(err.message, 500);
  }
}

// GET /api/tmdb/details?type=movie|tv&id=123
export async function details(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  if (!type || !id) return fail('type and id required');

  try {
    const data = type === 'tv'
      ? await tmdb.getTVDetails(env, id)
      : await tmdb.getMovieDetails(env, id);

    return ok({
      data: {
        ...data,
        poster_url: tmdb.posterUrl(data.poster_path, 'w500'),
        backdrop_url: tmdb.backdropUrl(data.backdrop_path, 'w1280'),
        trailer_key: tmdb.extractTrailer(data.videos),
        cast: tmdb.extractCast(data.credits, 10),
        genres: tmdb.extractGenres(data.genres),
      },
    });
  } catch (err) {
    return fail(err.message, 500);
  }
}

// GET /api/tmdb/season?id=123&season=1
export async function season(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const n = url.searchParams.get('season');
  if (!id || !n) return fail('id and season required');

  try {
    const data = await tmdb.getTVSeason(env, id, n);
    return ok({ data });
  } catch (err) {
    return fail(err.message, 500);
  }
}