// Cloudflare R2 වලින් වීඩියෝ සහ subtitles යවන file එක
// Range requests support කරනවා (seek කරන්න, resume කරන්න)
import { getAll, getOne } from '../lib/db.js';

async function isPublicMediaKey(env, key) {
  const result = await getOne(
    env,
    `SELECT 1 AS allowed
     WHERE EXISTS (
       SELECT 1 FROM movies m JOIN videos v ON v.id = m.video_id
       WHERE m.status = 'published' AND (v.r2_key = ? OR v.hls_master_key = ?)
     )
     OR EXISTS (
       SELECT 1 FROM episodes e
       JOIN tv_series t ON t.id = e.series_id
       JOIN videos v ON v.id = e.video_id
       WHERE t.status = 'published' AND (v.r2_key = ? OR v.hls_master_key = ?)
     )
     OR EXISTS (
       SELECT 1 FROM video_sources vs
       WHERE vs.r2_key = ? AND (
         EXISTS (SELECT 1 FROM movies m WHERE m.status = 'published' AND m.video_source_id = vs.id)
         OR EXISTS (
           SELECT 1 FROM episodes e JOIN tv_series t ON t.id = e.series_id
           WHERE t.status = 'published' AND e.video_source_id = vs.id
         )
       )
     )
     OR EXISTS (
       SELECT 1 FROM video_sources vs
       WHERE ? IN ('subtitles/' || vs.id || '_sin.vtt', 'subtitles/' || vs.id || '_eng.vtt')
         AND (
           EXISTS (SELECT 1 FROM movies m WHERE m.status = 'published' AND m.video_source_id = vs.id)
           OR EXISTS (
             SELECT 1 FROM episodes e JOIN tv_series t ON t.id = e.series_id
             WHERE t.status = 'published' AND e.video_source_id = vs.id
           )
         )
     )`,
    key, key, key, key, key, key
  );
  if (result) return true;

  const hlsSources = await getAll(
    env,
    `SELECT DISTINCT v.hls_master_key
     FROM videos v
     WHERE v.kind = 'hls' AND v.hls_master_key IS NOT NULL AND (
       EXISTS (SELECT 1 FROM movies m WHERE m.status = 'published' AND m.video_id = v.id)
       OR EXISTS (
         SELECT 1 FROM episodes e JOIN tv_series t ON t.id = e.series_id
         WHERE t.status = 'published' AND e.video_id = v.id
       )
     )`
  );

  return hlsSources.some(({ hls_master_key: masterKey }) => {
    const directoryEnd = masterKey.lastIndexOf('/');
    return directoryEnd >= 0 && key.startsWith(masterKey.slice(0, directoryEnd + 1));
  });
}

export async function stream(request, env) {
  const url = new URL(request.url);
  // URL එකේ මුල් /stream/ කොටස අයින් කරලා key එක ගන්නවා
  // උදා: /stream/movies/inception.mp4 -> movies/inception.mp4
  let key;
  try {
    key = decodeURIComponent(url.pathname.replace(/^\/stream\//, ''));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!key) return new Response('Not found', { status: 404 });
  if (!(await isPublicMediaKey(env, key))) {
    return new Response('Video not found', { status: 404 });
  }

  // R2 එකෙන් object එක ගන්නවා
  const object = await env.R2.get(key);

  if (!object) {
    return new Response('Video not found', { status: 404 });
  }

  // CORS headers (browser එකට වීඩියෝ ගන්න අවසර දෙන්න)
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');

  // Browser එකෙන් Range header එකක් එවලා තියෙනවද බලනවා
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    // Range නැත්නම් මුළු ෆයිල් එකම යවනවා (සාමාන්‍යයෙන් මේක browser එක කරන්නේ නෑ)
    headers.set('Content-Length', object.size);
    return new Response(object.body, { headers });
  }

  // Range header එක parse කරනවා (උදා: "bytes=0-1048575")
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response('Invalid Range', { status: 416 });
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : object.size - 1;

  if (start >= object.size || end >= object.size || start > end) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${object.size}` },
    });
  }

  const length = end - start + 1;

  // R2 එකෙන් කොටසක් විතරක් ගන්නවා (මේකයි main trick එක)
  const partial = await env.R2.get(key, {
    range: { offset: start, length },
  });

  headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
  headers.set('Content-Length', length);

  return new Response(partial.body, {
    status: 206, // Partial Content
    headers,
  });
}