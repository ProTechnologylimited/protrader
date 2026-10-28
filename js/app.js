/* App shell: header, navigation, router, boot. */
(function () {
  const PT = window.PT, u = PT.u;
  const NAV = [['trade', 'Trade', '#/trade'], ['meme', 'Memecoins', '#/meme'], ['ipo', 'IPOs', '#/ipo'], ['airdrops', 'Airdrops', '#/airdrops'], ['earn', 'Earn', '#/earn'], ['bots', 'Bots', '#/bots']];
  let cleanup = null, current = null;

  const brandName = () => PT.store.s.brand || PT.config.brand.name;

  function header() {
    const W = PT.wallet, bal = PT.store.bal('USDT');
    u.$('#topbar').innerHTML = `
      <a class="brand" href="#/trade" aria-label="${u.esc(brandName())} home"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M10 24V8h7.2a5 5 0 0 1 0 10H14" fill="none" stroke="var(--on-accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 24l7-7" stroke="var(--up)" stroke-width="3" stroke-linecap="round"/></svg><span>${u.esc(brandName())}</span></a>
      <nav class="nav" aria-label="Main">${NAV.map(([k, l, h]) => `<a href="${h}" data-k="${k}">${l}</a>`).join('')}<a href="#/wallet" data-k="wallet">Wallet</a></nav>
      <div class="actions">
        ${PT.config.demoMode ? '<span class="badge warn demo-badge" title="All funds and prices are simulated">Demo</span>' : ''}
        <button class="icon-btn" id="h-theme" aria-label="Brand colours">${PT.icon('palette')}</button>
        <a class="balchip" href="#/wallet" title="Available USDT">${u.usd(bal)}</a>
        <button class="btn ghost hide-s" id="h-dep">Deposit</button>
        ${W.connected()
          ? `<button class="btn wallet on" id="h-wallet" aria-haspopup="true"><i class="dot"></i>${u.short(W.address)}</button>`
          : `<button class="btn primary" id="h-wallet">Connect wallet</button>`}
      </div>`;
    u.$('#h-theme').onclick = () => PT.theme.open();
    u.$('#h-dep').onclick = () => PT.wallet.openDeposit();
    u.$('#h-wallet').onclick = () => (PT.wallet.connected() ? walletMenu() : PT.wallet.openConnect());
    markNav();
  }
  function walletMenu() {
    const W = PT.wallet;
    const m = PT.ui.modal({
      title: 'Connected wallet', size: 'sm',
      html: `<div class="stack"><div class="addrbox"><div><small class="muted">${u.esc(W.chain || '')}${W.balance != null ? ' · ' + W.balance.toFixed(4) + ' ETH' : ''}</small><code>${u.esc(W.address)}</code></div><button class="btn ghost sm" id="m-copy">${PT.icon('copy', 15)} Copy</button></div>
        <button class="btn primary block" id="m-dep">Deposit USDT</button><button class="btn ghost block" id="m-out">Disconnect</button></div>`,
    });
    u.$('#m-copy', m.body).onclick = () => u.copy(W.address);
    u.$('#m-dep', m.body).onclick = () => { m.close(); PT.wallet.openDeposit(); };
    u.$('#m-out', m.body).onclick = async () => { await W.disconnect(); m.close(); PT.ui.toast('Wallet disconnected.'); };
  }
  function tabbar() {
    u.$('#tabbar').innerHTML = NAV.map(([k, l, h]) => `<a href="${h}" data-k="${k}">${PT.icon(k)}<span>${l}</span></a>`).join('');
  }
  function markNav() {
    u.$$('[data-k]', document).forEach((a) => { const on = a.dataset.k === current; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function footer() {
    u.$('#foot').innerHTML = `<span>© ${new Date().getFullYear()} ${u.esc(PT.config.brand.company)}</span><span class="muted">Prototype with simulated data. Trading digital assets is risky; you can lose everything you put in.</span>`;
  }

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'trade').split('/');
    const name = PT.views[parts[0]] ? parts[0] : 'trade';
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    current = name;
    const v = u.$('#view'); v.innerHTML = ''; v.dataset.page = name;
    cleanup = PT.views[name].mount(v, parts.slice(1)) || null;
    markNav(); window.scrollTo(0, 0);
    document.title = (name === 'trade' ? 'Trade' : name[0].toUpperCase() + name.slice(1)) + ' · ' + brandName();
  }

  function boot() {
    PT.theme.apply(PT.store.s.theme || PT.config.theme);
    PT.launch.ensureSeed();
    footer(); tabbar(); header(); route();
    window.addEventListener('hashchange', route);
    PT.bus.on('wallet', header); PT.bus.on('brand', header);
    let last = '';
    PT.bus.on('state', header);
    PT.bus.on('tick', () => { const k = u.usd(PT.store.bal('USDT')); if (k !== last) { last = k; const c = u.$('.balchip'); if (c) c.textContent = k; } });
    PT.market.start();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
