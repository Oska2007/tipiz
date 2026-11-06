export function isEmail(s) {
  if (typeof s !== 'string') return false;
  s = s.trim();
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isPassword(s) {
  return typeof s === 'string' && s.length >= 8 && s.length <= 128;
}

export function isName(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 60;
}

export function clean(s) {
  return typeof s === 'string' ? s.trim() : '';
}