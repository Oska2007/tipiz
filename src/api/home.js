import { ok } from '../lib/response.js';
import { getAll } from '../lib/db.js';
import * as tmdb from '../lib/tmdb.js';

function decorate(m, type) {
  return {
    id: m.id,
    media_type: type,
    title: m.title || m.name,
    overview: m.overview || '', // ← මේකයි අලුතින් එකතු කළේ
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    release_date: m.release_date || m.first_air_date,
    vote_average: m.vote_average || 0,
    poster_url: tmdb.posterUrl(m.poster_path),
    backdrop_url: tmdb.backdropUrl(m.backdrop_path),
  };
}

// GET /api/home — homepage එකේ හැම row එකකටම data
export async function home(request, env) {
  const [
    heroRow,
    trendingRows,
    popularRows,
    latestRows,
    topRatedRows,
    seriesRows,
    recentlyAdded,
    genreRows,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM movies
       WHERE status='published' AND backdrop_path IS NOT NULL
       ORDER BY vote_average DESC LIMIT 1`
    ).first(),
    env.DB.prepare(
      `SELECT * FROM movies WHERE status='published'
       ORDER BY created_at DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT * FROM movies WHERE status='published' AND vote_average >= 6
       ORDER BY vote_average DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT * FROM movies WHERE status='published' AND release_date IS NOT NULL
       ORDER BY release_date DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT * FROM movies WHERE status='published'
       ORDER BY vote_average DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT * FROM tv_series WHERE status='published'
       ORDER BY vote_average DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT id, title, poster_path, release_date, vote_average, 'movie' as media_type, created_at
       FROM movies WHERE status='published'
       UNION ALL
       SELECT id, name as title, poster_path, first_air_date as release_date, vote_average, 'tv' as media_type, created_at
       FROM tv_series WHERE status='published'
       ORDER BY created_at DESC LIMIT 14`
    ).all(),
    env.DB.prepare(
      `SELECT DISTINCT g.id, g.name FROM genres g
       INNER JOIN movie_genres mg ON mg.genre_id = g.id
       ORDER BY g.name LIMIT 20`
    ).all(),
  ]);

  // Hero movie — කිසිම movie එකක් නැත්නම් hero = null
  let hero = null;
  if (heroRow) {
    hero = {
      ...decorate(heroRow, 'movie'),
      overview: heroRow.overview || '',
      runtime: heroRow.runtime || 0,
      trailer_key: heroRow.trailer_key || null,
    };
  }

  return ok({
    hero,
    trending: trendingRows.results.map((r) => decorate(r, 'movie')),
    popular: popularRows.results.map((r) => decorate(r, 'movie')),
    latest: latestRows.results.map((r) => decorate(r, 'movie')),
    top_rated: topRatedRows.results.map((r) => decorate(r, 'movie')),
    popular_series: seriesRows.results.map((r) => decorate(r, 'tv')),
    recently_added: recentlyAdded.results.map((r) => ({
      ...r,
      poster_url: tmdb.posterUrl(r.poster_path),
    })),
    genres: genreRows.results,
  });
}