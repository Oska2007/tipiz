export async function rateLimit(env, bindingName, key) {
  const binding = env[bindingName];
  if (!binding) return { success: true };

  try {
    const rl = await binding.limit({ key });
    // ආරක්ෂාව: undefined එකක් ආවොත් pass කරන්න
    if (!rl || typeof rl.success !== 'boolean') {
      return { success: true };
    }
    return rl;
  } catch {
    // Rate limiter local dev එකේ fail වුණත් request block කරන්නේ නෑ
    return { success: true };
  }
}

export function clientKey(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}