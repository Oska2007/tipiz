// TIPIZ Worker — Main Entry Point (Final Release)
// Security Headers + All API Routes (Steps 1 to 8)
import * as vps from './api/vps.js';
import * as auth from './api/auth.js';
import * as setup from './api/setup.js';
import * as settings from './api/settings.js';
import * as admin from './api/admin.js';
import * as tmdbApi from './api/tmdb.js';
import * as movies from './api/movies.js';
import * as tv from './api/tv.js';
import * as home from './api/home.js';
import * as searchApi from './api/search.js';
import * as stream from './api/stream.js';
import * as watch from './api/watch.js';
import * as user from './api/user.js';
import * as upload from './api/upload.js';
import { fail } from './lib/response.js';

// ── Route Table ─────────────────────────────────
const routes = [
  // 1. Auth
  ['POST', '/api/auth/register', auth.register],
  ['POST', '/api/auth/login', auth.login],
  ['POST', '/api/auth/logout', auth.logout],
  ['GET', '/api/auth/me', auth.me],
  ['POST', '/api/auth/change-password', auth.changePassword],
  
  // 2. Setup
  ['POST', '/api/setup/admin', setup.createAdmin],
  ['GET', '/api/setup/status', setup.getStatus],

  // 3. Admin Dashboard & Settings
  ['GET', '/api/admin/dashboard', admin.dashboard],
  ['GET', '/api/settings', settings.getSettings],
  ['POST', '/api/settings', settings.updateSettings],

  // 4. TMDB (Admin)
  ['GET', '/api/tmdb/search', tmdbApi.search],
  ['GET', '/api/tmdb/details', tmdbApi.details],
  ['GET', '/api/tmdb/season', tmdbApi.season],

  // 5. Movies
  ['GET', '/api/movies', movies.listPublic],
  ['GET', '/api/movies/:id', movies.getPublic],
  ['GET', '/api/movies/:id/similar', movies.getSimilar],
  ['GET', '/api/admin/movies', movies.listAdmin],
  ['POST', '/api/movies/import', movies.importFromTMDB],
  ['PATCH', '/api/movies/:id/status', movies.setStatus],
  ['DELETE', '/api/movies/:id', movies.deleteMovie],
  ['POST', '/api/admin/movies/publish-drafts', movies.publishAllDrafts],

  // 6. TV Series
  ['GET', '/api/tv', tv.listPublic],
  ['GET', '/api/tv/:id', tv.getPublic],
  ['GET', '/api/tv/:id/episodes', tv.listEpisodes],
  ['GET', '/api/admin/tv', tv.listAdmin],
  ['GET', '/api/admin/tv/:id', tv.getAdminSeries],
  ['POST', '/api/tv/import', tv.importFromTMDB],
  ['POST', '/api/tv/:id/import-season', tv.importSeason],
  ['PATCH', '/api/tv/:id/status', tv.setStatus],
  ['DELETE', '/api/tv/:id', tv.deleteTV],
  ['POST', '/api/admin/tv/publish-drafts', tv.publishAllDrafts],

  // 7. Home & Search
  ['GET', '/api/home', home.home],
  ['GET', '/api/search', searchApi.search],

  // 8. Watch (Player data & Progress)
  ['GET', '/api/watch/:type/:id', watch.getWatchInfo],
  ['POST', '/api/watch/progress', watch.saveProgress],
  ['POST', '/api/vps/sync', vps.syncVideo],
  ['POST', '/api/vps/assign', vps.assignVideoSource],
  ['GET', '/api/vps/videos', vps.listVideoSources],
  ['GET', '/api/vps/backup', vps.backupDatabase],

  // 9. User Dashboard
  ['GET', '/api/user/stats', user.getDashboardStats],
  ['GET', '/api/user/watchlist', user.getWatchlist],
  ['GET', '/api/user/favorites', user.getFavorites],
  ['POST', '/api/user/watchlist', (req, env) => user.toggleList(req, env, 'watchlist')],
  ['POST', '/api/user/favorites', (req, env) => user.toggleList(req, env, 'favorites')],
  ['GET', '/api/user/check-status', user.checkStatus],
  ['GET', '/api/user/history', user.getHistory],

  // 10. Admin Uploads
  ['POST', '/api/admin/upload', upload.uploadVideo],
  ['GET', '/api/admin/videos', upload.listVideos],
  ['GET', '/api/admin/r2-files', upload.listR2Files],
  ['POST', '/api/admin/assign-video', upload.assignVideo],
  ['DELETE', '/api/admin/videos/:id', upload.deleteVideo],
];

// ── URL Pattern Matcher ─────────────────────────
function matchRoute(pattern, path) {
  const pParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  
  if (pParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) {
      params[pParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── Security Headers Wrapper ────────────────────
export default {
  async fetch(request, env, ctx) {
    const response = await handleRequest(request, env, ctx);
    
    const newHeaders = new Headers(response.headers);
    
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    newHeaders.set('Content-Security-Policy', 
      "default-src 'self'; " +
      "img-src 'self' data: https://image.tmdb.org https://i.ytimg.com; " +
      "media-src 'self' blob: data: https://cdn.jsdelivr.net; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline'; " +
      "frame-src 'self' https://www.youtube.com; " +
      "connect-src 'self' https://api.themoviedb.org https://cdn.jsdelivr.net;"
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};

// ── Main Logic ──────────────────────────────────
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // ─── 1. Health & DB Tests ─────────────────────
  if (path === '/api/health') {
    return Response.json({ 
      ok: true, 
      name: 'TIPIZ', 
      version: '1.0.0', 
      time: new Date().toISOString() 
    });
  }

  if (path === '/api/db-test') {
    try {
      const result = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all();
      return Response.json({ 
        ok: true, 
        tables: result.results.map((r) => r.name) 
      });
    } catch (err) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  // ─── 2. Video Streaming (R2) ──────────────────
  if (path.startsWith('/stream/')) {
    return stream.stream(request, env);
  }

  // ─── 3. API Routes ────────────────────────────
  if (path.startsWith('/api/')) {
    for (const [m, p, handler] of routes) {
      if (method !== m) continue;
      
      const params = matchRoute(p, path);
      if (!params) continue;

      try {
        return await handler(request, env, params.id, ctx);
      } catch (err) {
        console.error('API error:', err);
        return fail('Internal server error', 500);
      }
    }
    return fail('API route not found', 404);
  }

  // ─── 4. Static Files (Frontend) ───────────────
  return env.ASSETS.fetch(request);
}