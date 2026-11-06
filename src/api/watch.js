// වීඩියෝ play කරන්න ඕන data එක දෙන file එක
// Resume Watching සඳහා progress save කරනවා

import { ok, fail } from '../lib/response.js';
import { getOne, getAll, run, insert } from '../lib/db.js';
import { getSession } from '../middleware/auth.js';
import { requireCSRF } from '../middleware/auth.js';

// GET /api/watch/movie/:id
// GET /api/watch/episode/:id
export async function getWatchInfo(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/'); // ['', 'api', 'watch', 'movie', '123']
  const type = parts[3]; // movie හෝ episode
  const id = parts[4];

  if (!id) return fail('Missing ID');

  let media;
  let video;

  if (type === 'movie') {
    media = await getOne(
      env,
      `SELECT id, title, poster_path, backdrop_path, runtime, trailer_key, video_id
       FROM movies WHERE id = ? AND status = 'published'`,
      id
    );
    if (!media) return fail('Movie not found', 404);
    if (media.video_id) {
      video = await getOne(env, 'SELECT * FROM videos WHERE id = ?', media.video_id);
    }
  } else if (type === 'episode') {
    media = await getOne(
      env,
      `SELECT id, name as title, still_path, video_id, series_id, season_id, episode_number, overview
       FROM episodes WHERE id = ?`,
      id
    );
    if (!media) return fail('Episode not found', 404);
    if (media.video_id) {
      video = await getOne(env, 'SELECT * FROM videos WHERE id = ?', media.video_id);
    }

    // ඊළඟ episode එක හොයාගන්නවා
    const nextEp = await getOne(
      env,
      `SELECT id, name, episode_number FROM episodes 
       WHERE series_id = ? AND season_id = ? AND episode_number > ? 
       ORDER BY episode_number ASC LIMIT 1`,
      media.series_id, media.season_id, media.episode_number
    );
    if (nextEp) media.next_episode = nextEp;
  } else {
    return fail('Invalid watch type');
  }

  if (!video) {
    return fail('No video file attached to this media yet', 404);
  }

  // Subtitles
  const subtitles = await getAll(
    env,
    'SELECT id, language, label, r2_key, is_default FROM subtitles WHERE video_id = ?',
    video.id
  );

  // Resume (කලින් නැවැත්තුව තැන) — login වෙලා නම් විතරයි
  let progress = null;
  const session = await getSession(request, env);
  if (session) {
    const history = await getOne(
      env,
      `SELECT position_seconds, duration_seconds, completed 
       FROM watch_history WHERE user_id = ? AND media_type = ? AND media_id = ?`,
      session.sub,
      type, // movie හෝ episode
      id
    );
    if (history) progress = history;
  }

  // Response URL හදනවා
  // Video එකට /stream/<r2_key> කියන path එකෙන් යනවා
  const videoUrl = video.kind === 'hls' 
    ? `/stream/${video.hls_master_key || video.r2_key}` 
    : `/stream/${video.r2_key}`;

  return ok({
    type,
    media: {
      ...media,
      title: media.title || media.name,
    },
    video: {
      url: videoUrl,
      kind: video.kind,
      duration_seconds: video.duration_seconds,
    },
    subtitles: subtitles.map((s) => ({
      ...s,
      url: `/stream/${s.r2_key}`,
    })),
    progress,
  });
}

// POST /api/watch/progress
// වීඩියෝ එකේ progress එක save කරනවා
export async function saveProgress(request, env) {
  const session = await getSession(request, env);
  if (!session) return ok({ message: 'Not logged in, progress not saved' }); // Not a hard error

  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { media_type, media_id, series_id, season_number, episode_number, position_seconds, duration_seconds } = body;

  if (!media_type || !media_id) return fail('Missing media_type or media_id');

  // completed = true වෙනවා duration එකෙන් 95% ට වඩා බැලුවොත්
  const isCompleted = duration_seconds > 0 && position_seconds / duration_seconds > 0.95 ? 1 : 0;

  await run(
    env,
    `INSERT INTO watch_history 
      (user_id, media_type, media_id, series_id, season_number, episode_number, position_seconds, duration_seconds, completed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at`,
    session.sub,
    media_type,
    media_id,
    series_id || null,
    season_number || null,
    episode_number || null,
    Math.floor(position_seconds || 0),
    Math.floor(duration_seconds || 0),
    isCompleted,
    new Date().toISOString()
  );

  return ok({ message: 'Progress saved' });
}