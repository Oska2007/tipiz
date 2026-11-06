// TMDB API client + helpers

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

// API key එක settings table එකෙන්, නැත්නම් env එකෙන් ගන්නවා
export async function getApiKey(env) {
  try {
    const row = await env.DB
      .prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'")
      .first();
    if (row && row.value && row.value.trim()) {
      return { key: row.value.trim(), source: 'settings' };
    }
  } catch {}
  if (env.TMDB_API_KEY) {
    return { key: env.TMDB_API_KEY, source: 'env' };
  }
  return { key: null, source: null };
}

export async function tmdbFetch(env, path, params = {}) {
  const { key } = await getApiKey(env);
  if (!key) throw new Error('TMDB API key is not configured. Set it in admin settings.');

  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('api_key', key);
  url.searchParams.set('language', env.TMDB_LANGUAGE || 'en-US');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    // Cloudflare cache — same response 1h cache
    cf: { cacheTtl: 3600, cacheEverything: true },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TMDB HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Image URL helpers ────────────────────────
export function posterUrl(path, size = 'w500') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}
export function backdropUrl(path, size = 'w1280') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}
export function profileUrl(path, size = 'w185') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}
export function stillUrl(path, size = 'w300') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

// ── Search ───────────────────────────────────
export async function searchMovies(env, query, page = 1) {
  return tmdbFetch(env, '/search/movie', { query, page, include_adult: 'false' });
}
export async function searchTV(env, query, page = 1) {
  return tmdbFetch(env, '/search/tv', { query, page, include_adult: 'false' });
}

// ── Details ──────────────────────────────────
export async function getMovieDetails(env, id) {
  return tmdbFetch(env, `/movie/${id}`, { append_to_response: 'credits,videos' });
}
export async function getTVDetails(env, id) {
  return tmdbFetch(env, `/tv/${id}`, { append_to_response: 'credits,videos' });
}
export async function getTVSeason(env, seriesId, seasonNumber) {
  return tmdbFetch(env, `/tv/${seriesId}/season/${seasonNumber}`);
}

// ── Extract helpers ──────────────────────────
export function extractTrailer(videos) {
  if (!videos?.results?.length) return null;
  const yt = videos.results.filter((v) => v.site === 'YouTube');
  const official = yt.find((v) => v.type === 'Trailer' && v.official);
  const anyTrailer = yt.find((v) => v.type === 'Trailer');
  return (official || anyTrailer || yt[0])?.key || null;
}

export function extractCast(credits, limit = 10) {
  if (!credits?.cast?.length) return [];
  return credits.cast.slice(0, limit).map((c) => ({
    id: c.id,
    name: c.name,
    character: c.character,
    profile_path: c.profile_path,
  }));
}

export function extractGenres(genres) {
  return (genres || []).map((g) => ({ id: g.id, name: g.name }));
}