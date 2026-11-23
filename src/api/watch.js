import { ok, fail } from '../lib/response.js';
import { getOne, getAll, run } from '../lib/db.js';
import { getSession } from '../middleware/auth.js';
import { requireCSRF } from '../middleware/auth.js';

function streamUrlForKey(key) {
  return `/stream/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function subtitleTrackIfPresent(env, { key, ...subtitle }) {
  if (!(await env.R2.head(key))) return null;
  return { ...subtitle, url: streamUrlForKey(key) };
}

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
       FROM episodes
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM tv_series
         WHERE tv_series.id = episodes.series_id AND tv_series.status = 'published'
       )`,
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

      const matchingSource = await getOne(
        env,
        'SELECT id FROM video_sources WHERE r2_key = ?',
        video.r2_key
      );
      if (matchingSource) videoSourceId = matchingSource.id;
    }
  }

  if (!videoUrl) {
    return fail('No video file attached to this media yet', 404);
  }

  // 3. Subtitles (අලුත් ක්‍රමය - R2 එකේ තියෙන වෙනම .vtt ෆයිල්ස්)
  let subtitles = [];
  if (videoSourceId) {
    const sourceSubtitles = [
      {
        label: 'Sinhala',
        language: 'si',
        is_default: true,
        key: `subtitles/${videoSourceId}_sin.vtt`,
      },
      {
        label: 'English',
        language: 'en',
        is_default: false,
        key: `subtitles/${videoSourceId}_eng.vtt`,
      },
    ];
    const tracks = await Promise.all(
      sourceSubtitles.map((subtitle) => subtitleTrackIfPresent(env, subtitle))
    );
    subtitles.push(...tracks.filter(Boolean));
  }

  if (media.video_id) {
    const subtitleRows = await getAll(
      env,
      `SELECT label, language, r2_key, is_default
       FROM subtitles
       WHERE video_id = ?
       ORDER BY is_default DESC, id ASC`,
      media.video_id
    );
    const registeredSubtitles = subtitleRows.filter(
      (subtitle) => typeof subtitle.r2_key === 'string' && /\.vtt$/i.test(subtitle.r2_key)
    );
    const registeredTracks = await Promise.all(
      registeredSubtitles.map((subtitle) => subtitleTrackIfPresent(env, {
        key: subtitle.r2_key,
        label: subtitle.label || subtitle.language || 'Subtitle',
        language: subtitle.language || 'en',
        is_default: Boolean(subtitle.is_default),
      }))
    );
    const availableRegisteredTracks = registeredTracks.filter(Boolean);
    subtitles.push(...availableRegisteredTracks);
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

  if (!body || typeof body !== 'object') return fail('Invalid request body');
  const { media_type, media_id, position_seconds, duration_seconds } = body;

  if (
    !['movie', 'episode'].includes(media_type) ||
    !Number.isSafeInteger(media_id) ||
    media_id < 1
  ) {
    return fail('Invalid media type or ID');
  }
  if (
    typeof position_seconds !== 'number' ||
    !Number.isFinite(position_seconds) ||
    position_seconds < 0 ||
    typeof duration_seconds !== 'number' ||
    !Number.isFinite(duration_seconds) ||
    duration_seconds < 0 ||
    position_seconds > duration_seconds
  ) {
    return fail('Invalid playback position or duration');
  }

  let seriesId = null;
  let seasonNumber = null;
  let episodeNumber = null;
  const media = media_type === 'movie'
    ? await getOne(env, "SELECT id FROM movies WHERE id = ? AND status = 'published'", media_id)
    : await getOne(
      env,
      `SELECT e.series_id, s.season_number, e.episode_number
       FROM episodes e
       JOIN seasons s ON s.id = e.season_id
       JOIN tv_series t ON t.id = e.series_id
       WHERE e.id = ? AND t.status = 'published'`,
      media_id
    );
  if (!media) return fail('Media not found', 404);
  if (media_type === 'episode') {
    seriesId = media.series_id;
    seasonNumber = media.season_number;
    episodeNumber = media.episode_number;
  }

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
    seriesId,
    seasonNumber,
    episodeNumber,
    Math.floor(position_seconds),
    Math.floor(duration_seconds),
    isCompleted,
    new Date().toISOString()
  );

  return ok({ message: 'Progress saved' });
}