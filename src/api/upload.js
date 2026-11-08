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

// ── 3. Assign Video to Movie or Episode (Updated) ──
export async function assignVideo(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const csrf = await requireCSRF(request);
  if (csrf) return csrf;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { video_id, r2_key, type, target_id } = body;
  if ((!video_id && !r2_key) || !type || !target_id) return fail('Missing fields');

  let targetVideoId = video_id;

  // r2_key එකක් එවලා තියෙනවා නම්, ඒක Database එකේ තියෙනවද බලලා නැත්නම් අලුතින් හදනවා
  if (!targetVideoId && r2_key) {
    let video = await getOne(env, 'SELECT id FROM videos WHERE r2_key = ?', r2_key);
    if (!video) {
      const title = r2_key.split('/').pop() || 'Cloudflare R2 Video';
      targetVideoId = await insert(env,
        `INSERT INTO videos (title, kind, r2_key) VALUES (?, 'mp4', ?)`,
        title, r2_key
      );
    } else {
      targetVideoId = video.id;
    }
  }

  if (!targetVideoId) return fail('Video not found');

  if (type === 'movie') {
    await run(env, 'UPDATE movies SET video_id = ?, updated_at = ? WHERE id = ?',
      targetVideoId, new Date().toISOString(), target_id);
  } else if (type === 'episode') {
    await run(env, 'UPDATE episodes SET video_id = ? WHERE id = ?', targetVideoId, target_id);
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

// ── 5. List All Files in R2 ──
export async function listR2Files(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  try {
    const listed = await env.R2.list({ limit: 100 });
    return ok({
      files: listed.objects.map(obj => ({
        key: obj.key,
        size_human: (obj.size / (1024 * 1024)).toFixed(1) + ' MB',
        uploaded: obj.uploaded
      }))
    });
  } catch (err) {
    return fail('Failed to list R2 files: ' + err.message, 500);
  }
}