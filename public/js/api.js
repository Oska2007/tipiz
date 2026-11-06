// TIPIZ frontend API helper

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const csrf = getCookie('tipiz_csrf');
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),

  me: () => request('GET', '/api/auth/me'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  register: (email, password, name) =>
    request('POST', '/api/auth/register', { email, password, name }),
  logout: () => request('POST', '/api/auth/logout'),
};

window.tipiz = { api, getCookie };