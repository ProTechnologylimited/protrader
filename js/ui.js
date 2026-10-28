/* Icons, toasts, modals and theming. */
(function () {
  const PT = window.PT, u = PT.u;
  PT.views = {};

  PT.icons = {
    trade: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    meme: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    ipo: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    airdrop: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    earn: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    bot: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  };
  PT.icon = (n, s = 18) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PT.icons[n] || ''}</svg>`;

  PT.ui = {
    toast(msg, type = 'info') {
      const box = u.$('#toasts');
      const t = u.h(`<div class="toast ${type}" role="status">${u.esc(msg)}</div>`);
      box.append(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 3600);
    },

    modal({ title, html, node, size = 'md', onClose }) {
      const layer = u.$('#layer');
      const wrap = u.h(`<div class="overlay"><div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${u.esc(title)}" tabindex="-1">
        <div class="mhead"><h2>${u.esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${PT.icon('close')}</button></div>
        <div class="mbody"></div></div></div>`);
      const body = u.$('.mbody', wrap);
      if (html != null) body.innerHTML = html;
      if (node) body.append(node);
      const opener = document.activeElement;
      function onKey(e) { if (e.key === 'Escape' && layer.lastElementChild === wrap) close(); }
      function close() {
        if (!wrap.isConnected) return;
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        document.body.classList.toggle('lock', layer.children.length > 0);
        if (onClose) onClose();
        if (opener && opener.focus) opener.focus();
      }
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
      u.$('[data-close]', wrap).onclick = close;
      document.addEventListener('keydown', onKey);
      layer.append(wrap);
      document.body.classList.add('lock');
      u.$('.modal', wrap).focus();
      return { el: wrap, body, close };
    },
  };

  /* ---------- Theming ---------- */
  const presets = {
    ProTechnology: { bg: '#101116', surface: '#1A1B22', text: '#F4F1EA', accent: '#8E82F4', up: '#2FD9A6', down: '#FF5C77' },
    Midnight: { bg: '#0B1020', surface: '#121A2F', text: '#E8ECF8', accent: '#6C7CFF', up: '#2FD9A6', down: '#FF5C77' },
    'Graphite gold': { bg: '#0F0F11', surface: '#18181C', text: '#F2EFE8', accent: '#E8B04A', up: '#3DDC97', down: '#FF5A5F' },
    'Deep forest': { bg: '#08140F', surface: '#0F211A', text: '#E6F2EC', accent: '#3FB8AF', up: '#7BE495', down: '#FF7A66' },
    Daylight: { bg: '#F3F5FA', surface: '#FFFFFF', text: '#151B2E', accent: '#4B5BEF', up: '#0E9F6E', down: '#E0334F' },
  };
  function lum(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }
  PT.theme = {
    presets,
    current: null,
    apply(t) {
      const r = document.documentElement.style;
      this.current = Object.assign({}, PT.config.theme, t);
      const c = this.current;
      ['bg', 'surface', 'text', 'accent', 'up', 'down'].forEach((k) => r.setProperty('--' + k, c[k]));
      const on = (bgc, dark) => ((1.05) / (lum(bgc) + 0.05) >= (lum(bgc) + 0.05) / (lum(dark) + 0.05) ? '#FFFFFF' : dark);
      r.setProperty('--on-accent', on(c.accent, '#14121F'));
      r.setProperty('--on-up', on(c.up, '#07130F'));
      r.setProperty('--on-down', on(c.down, '#1A0509'));
      const light = lum(c.bg) > 0.5;
      r.setProperty('color-scheme', light ? 'light' : 'dark');
      const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = c.bg;
      PT.bus.emit('theme');
    },
    save() { PT.store.s.theme = this.current; PT.store.commit(); },
    open() {
      const c = this.current;
      const fields = [['bg', 'Background'], ['surface', 'Panels'], ['text', 'Text'], ['accent', 'Brand accent'], ['up', 'Buy / gain'], ['down', 'Sell / loss']];
      const m = PT.ui.modal({
        title: 'Brand colours', size: 'sm',
        html: `<p class="muted">Match the app to the ProTechnology Limited identity. Changes apply instantly and are saved on this device.</p>
        <div class="presets">${Object.keys(presets).map((n) => `<button class="chip" data-preset="${u.esc(n)}">${u.esc(n)}</button>`).join('')}</div>
        <div class="colorgrid">${fields.map(([k, l]) => `<label class="colorfield"><span>${l}</span><input type="color" data-k="${k}" value="${c[k]}"></label>`).join('')}</div>
        <label class="field"><span>Brand name</span><input class="input" id="brandname" maxlength="24" value="${u.esc(PT.store.s.brand || PT.config.brand.name)}"></label>
        <div class="row end"><button class="btn ghost" id="theme-reset">Reset to default</button><button class="btn primary" data-close2>Done</button></div>`,
      });
      const body = m.body;
      body.addEventListener('input', (e) => {
        const k = e.target.dataset && e.target.dataset.k;
        if (k) { PT.theme.apply({ ...PT.theme.current, [k]: e.target.value }); PT.theme.save(); }
        if (e.target.id === 'brandname') { PT.store.s.brand = e.target.value.trim() || null; PT.store.commit(); PT.bus.emit('brand'); }
      });
      body.addEventListener('click', (e) => {
        const p = e.target.closest('[data-preset]');
        if (p) { PT.theme.apply(presets[p.dataset.preset]); PT.theme.save(); u.$$('input[data-k]', body).forEach((i) => (i.value = PT.theme.current[i.dataset.k])); }
        if (e.target.id === 'theme-reset') { PT.theme.apply(PT.config.theme); PT.store.s.theme = null; PT.store.s.brand = null; PT.store.commit(); PT.bus.emit('brand'); m.close(); }
        if (e.target.hasAttribute('data-close2')) m.close();
      });
    },
  };
})();
