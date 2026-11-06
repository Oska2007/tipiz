import { ok } from '../lib/response.js';
import { getOne } from '../lib/db.js';
import { requireAdmin } from '../middleware/auth.js';

// GET /api/admin/dashboard
export async function dashboard(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const [movies, series, users, videos, publishedMovies, publishedSeries] = await Promise.all([
    getOne(env, 'SELECT COUNT(*) as c FROM movies'),
    getOne(env, 'SELECT COUNT(*) as c FROM tv_series'),
    getOne(env, 'SELECT COUNT(*) as c FROM users'),
    getOne(env, 'SELECT COUNT(*) as c FROM videos'),
    getOne(env, "SELECT COUNT(*) as c FROM movies WHERE status = 'published'"),
    getOne(env, "SELECT COUNT(*) as c FROM tv_series WHERE status = 'published'"),
  ]);

  const storage = await getOne(env, 'SELECT SUM(size_bytes) as s FROM videos');

  return ok({
    stats: {
      movies: movies?.c || 0,
      published_movies: publishedMovies?.c || 0,
      series: series?.c || 0,
      published_series: publishedSeries?.c || 0,
      users: users?.c || 0,
      videos: videos?.c || 0,
      storage_bytes: storage?.s || 0,
      storage_human: formatBytes(storage?.s || 0),
    },
  });
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}