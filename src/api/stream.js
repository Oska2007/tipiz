// Cloudflare R2 වලින් වීඩියෝ සහ subtitles යවන file එක
// Range requests support කරනවා (seek කරන්න, resume කරන්න)

export async function stream(request, env) {
  const url = new URL(request.url);
  // URL එකේ මුල් /stream/ කොටස අයින් කරලා key එක ගන්නවා
  // උදා: /stream/movies/inception.mp4 -> movies/inception.mp4
  const key = decodeURIComponent(url.pathname.replace(/^\/stream\//, ''));

  if (!key) return new Response('Not found', { status: 404 });

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