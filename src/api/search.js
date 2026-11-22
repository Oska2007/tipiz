import { ok } from '../lib/response.js';
import { getAll } from '../lib/db.js';
import * as tmdb from '../lib/tmdb.js';

// GET /api/search?q=...&type=all|movie|tv&year=YYYY&genre=Action&lang=en
export async function search(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const type = url.searchParams.get('type') || 'all';
  const year = url.searchParams.get('year');
  const genre = url.searchParams.get('genre'); // අලුතින් එකතු කළා
  const language = (url.searchParams.get('lang') || '').trim().toLowerCase();
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '30', 10));

  // මොකක් හරි එකක් search කරලා තියෙන්න ඕන (Text, Year, හෝ Genre)
  if (!q && !year && !genre && !language) return ok({ results: [], total: 0 });

  const results = [];

  // ── Movies ──
  if (type === 'all' || type === 'movie') {
    let where = "status='published'";
    const params = [];

    if (q) { where += " AND title LIKE ?"; params.push(`%${q}%`); }
    if (year) { where += " AND substr(release_date, 1, 4) = ?"; params.push(String(year)); }
    if (genre) { where += " AND genres_json LIKE ?"; params.push(`%"name":"${genre}"%`); }
    if (language) { where += " AND original_language = ?"; params.push(language); }

    const rows = await getAll(
      env,
      `SELECT id, title, poster_path, release_date, vote_average, original_language
       FROM movies WHERE ${where}
       ORDER BY vote_average DESC LIMIT ?`,
      ...params, limit
    );
    results.push(
      ...rows.map((r) => ({
        ...r,
        media_type: 'movie',
        poster_url: tmdb.posterUrl(r.poster_path),
      }))
    );
  }

  // ── TV Series ──
  if (type === 'all' || type === 'tv') {
    let where = "status='published'";
    const params = [];

    if (q) { where += " AND name LIKE ?"; params.push(`%${q}%`); }
    if (year) { where += " AND substr(first_air_date, 1, 4) = ?"; params.push(String(year)); }
    if (genre) { where += " AND genres_json LIKE ?"; params.push(`%"name":"${genre}"%`); }
    if (language) { where += " AND original_language = ?"; params.push(language); }

    const rows = await getAll(
      env,
      `SELECT id, name as title, poster_path, first_air_date as release_date, vote_average, original_language
       FROM tv_series WHERE ${where}
       ORDER BY vote_average DESC LIMIT ?`,
      ...params, limit
    );
    results.push(
      ...rows.map((r) => ({
        ...r,
        media_type: 'tv',
        poster_url: tmdb.posterUrl(r.poster_path),
      }))
    );
  }

  // Rating එක අනුව Sort කරන්න
  results.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

  return ok({ results: results.slice(0, limit), total: results.length });
}