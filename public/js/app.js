// TIPIZ frontend shared helpers
// පොදුවේ පාවිච්චි කරන functions (cards, navbar, auth state)

const { api } = window.tipiz;
const languageDisplayNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'language' })
  : null;

// ── HTML escape (XSS protection) ──────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function languageName(code) {
  const language = String(code || '').trim();
  if (!language) return '';

  try {
    return languageDisplayNames?.of(language) || language.toUpperCase();
  } catch {
    return language.toUpperCase();
  }
}

// ── Movie card ────────────────────────────────
export function movieCard(m) {
  const title = esc(m.title || 'Untitled');
  const year = m.release_date ? String(m.release_date).slice(0, 4) : '';
  const rating = m.vote_average ? Number(m.vote_average).toFixed(1) : '—';
  const poster = m.poster_url || placeholderPoster();
  const href = (m.media_type === 'tv' ? '/tv.html?id=' : '/movie.html?id=') + m.id;
  const badge = m.media_type === 'tv'
    ? '<span class="card-badge">TV</span>'
    : '';

  return `
    <a href="${href}" class="movie-card">
      <div class="card-poster">
        <img src="${esc(poster)}" alt="${title}" loading="lazy" />
        ${badge}
        <div class="card-overlay">
          <span class="card-rating">★ ${rating}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title" title="${title}">${title}</div>
        <div class="card-meta">${year || '—'}</div>
      </div>
    </a>
  `;
}

export function placeholderPoster() {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450">
      <rect width="300" height="450" fill="#0a0f1c"/>
      <text x="150" y="225" text-anchor="middle" fill="#2a3550" font-family="sans-serif" font-size="14">No poster</text>
    </svg>`
  );
}

// ── Render a horizontal scrollable row of cards ──
export function renderRow(container, movies) {
  if (!container) return;
  if (!movies || !movies.length) {
    container.closest('.row-section')?.classList.add('row-empty');
    container.innerHTML = '';
    return;
  }
  container.innerHTML = movies.map(movieCard).join('');
}

// ── Navbar auth state ────────────────────────
export async function initNavbar() {
  const authSlot = document.getElementById('nav-auth');
  if (!authSlot) return;

  try {
    const { user } = await api.me();
    authSlot.innerHTML = user.role === 'admin'
      ? `<a href="/dashboard.html" class="nav-user">${esc(user.name)}</a>
         <a href="/admin/" class="btn-nav-outline">Admin</a>`
      : `<a href="/dashboard.html" class="nav-user">${esc(user.name)}</a>`;
  } catch {
    // "Sign in" බටන් එක අයින් කළා, දැන් තියෙන්නේ "Sign up" විතරයි
    authSlot.innerHTML = `
      <a href="/register.html" class="btn-nav">Sign up</a>
    `;
  }
}

// ── Search bar (navbar) ──────────────────────
export function initSearchBar() {
  const toggle = document.getElementById('nav-search-toggle');
  const form = document.getElementById('nav-search-form');
  const input = form?.querySelector('input[type="search"]');
  if (!toggle || !form || !input) return;

  const closeSearch = () => {
    form.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const shouldOpen = form.hidden;
    form.hidden = !shouldOpen;
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) input.focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
  });

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target) && !toggle.contains(e.target)) closeSearch();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !form.hidden) {
      closeSearch();
      toggle.focus();
    }
  });
}

// ── Auto-initialize shared parts ─────────────
export function initPage() {
  initNavbar();
  initSearchBar();
}