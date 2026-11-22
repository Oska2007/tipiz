import { ok, fail } from '../lib/response.js';
import { getOne, getAll, run } from '../lib/db.js';
import { getSession } from '../middleware/auth.js';
import { requireCSRF } from '../middleware/auth.js';

// GET /api/watch/movie/:id
// GET /api/watch/episode/:id
export async function getWatchInfo(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/'); 
  const type = parts[3]; // movie හෝ episode
  const id = parts[4];

  if (!id) return fail('Missing ID');

  let media;
  let videoUrl = null;
  let videoKind = 'mp4';
  let durationSeconds = 0;
  let videoSourceId = null;

  if (type === 'movie') {
    media = await getOne(
      env,
      `SELECT id, title, poster_path, backdrop_path, runtime, trailer_key, video_id, video_source_id
       FROM movies WHERE id = ? AND status = 'published'`,
      id
    );
    if (!media) return fail('Movie not found', 404);
  } else if (type === 'episode') {
    media = await getOne(
      env,
      `SELECT id, name as title, still_path, video_id, video_source_id, series_id, season_id, episode_number, overview
       FROM episodes WHERE id = ?`,
      id
    );
    if (!media) return fail('Episode not found', 404);

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

  // 1. අලුත් සිස්ටම් එක (Permanent ID)
  if (media.video_source_id) {
    const videoSource = await getOne(env, 'SELECT * FROM video_sources WHERE id = ?', media.video_source_id);
    if (videoSource) {
      videoUrl = `/stream/${videoSource.r2_key}`;
      videoKind = 'mp4';
      videoSourceId = videoSource.id;
    }
  }

  // 2. පරණ සිස්ටම් එක (videos table)
  if (!videoUrl && media.video_id) {
    const video = await getOne(env, 'SELECT * FROM videos WHERE id = ?', media.video_id);
    if (video) {
      videoUrl = video.kind === 'hls' 
        ? `/stream/${video.hls_master_key || video.r2_key}` 
        : `/stream/${video.r2_key}`;
      videoKind = video.kind;
      durationSeconds = video.duration_seconds || 0;
    }
  }

  if (!videoUrl) {
    return fail('No video file attached to this media yet', 404);
  }

  // 3. Subtitles (අලුත් ක්‍රමය - R2 එකේ තියෙන වෙනම .vtt ෆයිල්ස්)
  let subtitles = [];
  if (videoSourceId) {
    subtitles.push({
      label: 'Sinhala',
      language: 'si',
      url: `/stream/subtitles/${videoSourceId}_sin.vtt`
    });
    subtitles.push({
      label: 'English',
      language: 'en',
      url: `/stream/subtitles/${videoSourceId}_eng.vtt`
    });
  }

  // 4. Resume (කලින් නැවැත්තුව තැන)
  let progress = null;
  const session = await getSession(request, env);
  if (session) {
    const history = await getOne(
      env,
      `SELECT position_seconds, duration_seconds, completed 
       FROM watch_history WHERE user_id = ? AND media_type = ? AND media_id = ?`,
      session.sub,
      type, 
      id
    );
    if (history) progress = history;
  }

  return ok({
    type,
    media: {
      ...media,
      title: media.title || media.name,
    },
    video: {
      url: videoUrl,
      kind: videoKind,
      duration_seconds: durationSeconds,
    },
    subtitles: subtitles,
    progress,
  });
}

// POST /api/watch/progress
export async function saveProgress(request, env) {
  const session = await getSession(request, env);
  if (!session) return ok({ message: 'Not logged in, progress not saved' }); 

  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { media_type, media_id, series_id, season_number, episode_number, position_seconds, duration_seconds } = body;

  if (!media_type || !media_id) return fail('Missing media_type or media_id');

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