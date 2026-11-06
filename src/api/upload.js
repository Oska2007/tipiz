import { ok, fail } from '../lib/response.js';
import { getOne, getAll, insert, run } from '../lib/db.js';
import { requireAdmin, requireCSRF } from '../middleware/auth.js';

// ── 1. Upload Video to R2 ──
export async function uploadVideo(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const title = formData.get('title') || 'Untitled Video';

    if (!file || !(file instanceof File)) return fail('No file uploaded');
    if (file.size > 100 * 1024 * 1024) return fail('File too large. Max 100MB for free plan.', 413);

    // Generate a unique key for R2
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const r2_key = `uploads/${Date.now()}-${safeName}`;

    // Upload to R2
    await env.R2.put(r2_key, file.stream(), {
      httpMetadata: { contentType: file.type || 'video/mp4' },
    });

    // Save to D1
    const videoId = await insert(
      env,
      `INSERT INTO videos (title, kind, r2_key, size_bytes) VALUES (?, 'mp4', ?, ?)`,
      title, r2_key, file.size
    );

    return ok({ message: 'Video uploaded successfully', video_id: videoId, r2_key });
  } catch (err) {
    console.error('Upload error:', err);
    return fail('Upload failed: ' + err.message, 500);
  }
}

// ── 2. Get All Videos ──
export async function listVideos(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const rows = await getAll(env,
    `SELECT id, title, r2_key, size_bytes, duration_seconds, created_at 
     FROM videos ORDER BY created_at DESC LIMIT 100`
  );

  return ok({
    results: rows.map(v => ({
      ...v,
      size_human: (v.size_bytes / (1024 * 1024)).toFixed(1) + ' MB',
      stream_url: '/stream/' + v.r2_key
    }))
  });
}

// ── 3. Assign Video to Movie or Episode ──
export async function assignVideo(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { video_id, type, target_id } = body;
  if (!video_id || !type || !target_id) return fail('Missing fields');

  const video = await getOne(env, 'SELECT id FROM videos WHERE id = ?', video_id);
  if (!video) return fail('Video not found');

  if (type === 'movie') {
    await run(env, 'UPDATE movies SET video_id = ?, updated_at = ? WHERE id = ?',
      video_id, new Date().toISOString(), target_id);
  } else if (type === 'episode') {
    await run(env, 'UPDATE episodes SET video_id = ? WHERE id = ?', video_id, target_id);
  } else {
    return fail('Invalid type');
  }

  return ok({ message: `Video assigned to ${type}` });
}

// ── 4. Delete Video ──
export async function deleteVideo(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  const video = await getOne(env, 'SELECT r2_key FROM videos WHERE id = ?', id);
  if (!video) return fail('Video not found', 404);

  // Remove from R2
  await env.R2.delete(video.r2_key);
  // Remove from D1
  await run(env, 'DELETE FROM videos WHERE id = ?', id);

  return ok({ message: 'Video deleted' });
}