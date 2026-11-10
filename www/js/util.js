/* Small helpers shared by every module. */
(function () {
  const PT = (window.PT = window.PT || {});
  const u = (PT.u = {});

  u.$ = (s, r = document) => r.querySelector(s);
  u.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  u.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  u.h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  u.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
  u.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  u.rand = (a, b) => a + Math.random() * (b - a);
  u.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  u.gauss = () => { let a = 0, b = 0; while (!a) a = Math.random(); while (!b) b = Math.random(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };

  u.price = (n) => {
    n = Number(n) || 0;
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(4);
    if (n >= 0.01) return n.toFixed(5);
    if (n <= 0) return '0.00';
    const d = Math.min(14, 2 - Math.floor(Math.log10(n)) + 2);
    return n.toFixed(d);
  };
  u.usd = (n, d = 2) => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  u.compact = (n) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n || 0);
  u.qty = (n) => {
    n = Number(n) || 0;
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return String(+n.toFixed(4));
    return String(+n.toFixed(6));
  };
  u.pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  u.dir = (n) => (n >= 0 ? 'up' : 'down');
  u.short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  u.floorTo = (n, d = 6) => Math.floor(n * 10 ** d + 1e-9) / 10 ** d;
  u.timeAgo = (t) => {
    const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };
  u.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); PT.ui.toast('Copied', 'ok'); }
    catch { PT.ui.toast('Copy failed. Select and copy manually.', 'err'); }
  };

  /* tiny pub/sub */
  const subs = {};
  PT.bus = {
    on(ev, fn) { (subs[ev] = subs[ev] || new Set()).add(fn); return () => subs[ev].delete(fn); },
    emit(ev, data) { (subs[ev] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); },
  };
})();
