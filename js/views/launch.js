/* Memecoin launchpad and tokenized IPO listings.
   Both use a constant-product bonding curve: the amount paid to launch (seed) sets the
   starting price = seed / supply, so a bigger seed means a higher starting price. */
(function () {
  const PT = window.PT, u = PT.u, cfg = PT.config;

  const EMOJI = ['🐸', '🐱', '🐕', '🚀', '🦍', '🔥', '🌙', '🍀', '👾', '🦊', '🐳', '💎'];
  const SECTORS = ['Energy', 'Healthcare', 'Logistics', 'Fintech', 'Consumer', 'Software', 'Real estate', 'Agriculture'];

  /* ---------- curve maths ---------- */
  const price = (t) => t.x / t.y;
  const mcap = (t) => price(t) * t.supply;
  const gradTarget = (t) => (t.kind === 'meme' ? cfg.launch.memeGraduationMcap : cfg.launch.ipoGraduationMcap);
  const progress = (t) => u.clamp((mcap(t) - t.x0) / (gradTarget(t) - t.x0), 0, 1);
  function quoteBuy(t, usdt) {
    const fee = usdt * cfg.fees.curve, inn = usdt - fee, yNew = t.k / (t.x + inn), out = t.y - yNew;
    const after = (t.x + inn) / yNew;
    return { fee, inn, out, yNew, impact: after / price(t) - 1 };
  }
  function quoteSell(t, q) {
    const xNew = t.k / (t.y + q), gross = t.x - xNew, fee = gross * cfg.fees.curve;
    return { gross, fee, out: gross - fee, xNew, impact: xNew / (t.y + q) / price(t) - 1 };
  }
  function applyBuy(t, usdt) { const r = quoteBuy(t, usdt); t.x += r.inn; t.y = r.yNew; record(t, usdt); return r; }
  function applySell(t, q) { const r = quoteSell(t, q); t.x = r.xNew; t.y += q; record(t, r.gross); return r; }
  function record(t, vol) {
    t.vol += vol; t.trades++;
    t.hist.push(price(t)); if (t.hist.length > 150) t.hist.shift();
    if (!t.graduated && mcap(t) >= gradTarget(t)) t.graduated = true;
  }

  function makeToken(o) {
    const x = o.seed, y = o.supply;
    return Object.assign({
      id: u.uid('tk'), created: Date.now(), x, y, k: x * y, x0: x, p0: x / y,
      vol: 0, holders: 1, trades: 0, hist: [x / y], graduated: false, verified: false, creator: 'you', meta: {},
    }, o);
  }

  function ensureSeed() {
    const S = PT.store.s; if (S.launches) return;
    const L = [];
    [['Pepex', 'PEPX', '🐸', 800], ['Moon Cat', 'MCAT', '🐱', 1500], ['Sol Doge', 'SDOG', '🐕', 600], ['Rocket Fuel', 'FUEL', '🚀', 2500], ['Gorilla Gang', 'GGNG', '🦍', 1200]].forEach(([name, sym, emoji, seed], i) => {
      L.push(makeToken({ kind: 'meme', name, sym, emoji, hue: (i * 67 + 200) % 360, desc: 'Community-run memecoin launched on ProTrader.', seed, supply: cfg.launch.memeSupply, creator: 'pt-community', verified: true }));
    });
    [['Nova Grid Energy', 'NVGE', 'Energy', 250000, 1000000, 'Singapore'], ['Kora Health', 'KRHL', 'Healthcare', 420000, 1000000, 'United Kingdom'], ['Atlas Freight', 'ATLS', 'Logistics', 90000, 1000000, 'Kenya']].forEach(([name, sym, sector, seed, supply, jur], i) => {
      L.push(makeToken({ kind: 'ipo', name, sym, hue: (i * 90 + 30) % 360, desc: name + ' tokenized equity offering (demo company).', seed, supply, creator: 'pt-listings', verified: true, meta: { sector, jurisdiction: jur, website: 'https://example.com' } }));
    });
    L.forEach((t) => { for (let i = 0; i < 60; i++) simTrade(t, true); t.created = Date.now() - u.rand(2, 70) * 3600e3; t.holders = Math.floor(u.rand(40, 900)); });
    S.launches = L; PT.store.touch();
  }

  /* background activity from other traders so markets feel alive */
  function simTrade(t, quiet) {
    const buy = Math.random() < 0.54, size = Math.max(t.kind === 'meme' ? 5 : 200, t.x * u.rand(0.004, 0.03));
    if (buy) applyBuy(t, size);
    else { const q = size / price(t); if (t.x - quoteSell(t, q).gross > t.x0 * 0.9 && price(t) > t.p0 * 0.5) applySell(t, q); else applyBuy(t, size); }
    if (!quiet && Math.random() < 0.1) t.holders++;
  }
  let tk = 0;
  PT.bus.on('tick', () => {
    const L = PT.store.s.launches; if (!L || ++tk % 2) return;
    simTrade(u.pick(L)); PT.store.touch();
  });

  PT.launch = { price, mcap, ensureSeed, list: () => PT.store.s.launches || [] };

  /* ---------- views ---------- */
  function view(kind) {
    return {
      mount(root) {
        const isMeme = kind === 'meme';
        const T = isMeme
          ? { title: 'Memecoins', sub: 'Launch a token in under a minute. The seed you pay is locked in the curve, so creators cannot pull liquidity.', cta: 'Launch memecoin', unit: 'coin', empty: 'No coins here yet. Launch the first one.' }
          : { title: 'IPO listings', sub: 'List a company as tokenized shares. The listing amount sets the opening share price. Listings from new issuers show as unverified until reviewed.', cta: 'List a company', unit: 'share', empty: 'No listings match this filter.' };
        let filter = 'trending';
        root.innerHTML = `<div class="page">
          <div class="pagehead"><div><h1>${T.title}</h1><p class="muted lead">${T.sub}</p></div><button class="btn primary" id="l-new">${PT.icon('plus', 16)} ${T.cta}</button></div>
          <div class="seg" id="l-f"><button data-f="trending">Trending</button><button data-f="new">New</button><button data-f="verified">Verified</button><button data-f="mine">Created by you</button></div>
          <div class="cards" id="l-grid"></div>
          ${isMeme ? `<p class="note">${PT.icon('alert', 16)}<span>Memecoins are extremely volatile and can go to zero. Never trade more than you can afford to lose. All balances here are demo funds.</span></p>`
            : `<p class="note">${PT.icon('alert', 16)}<span>Tokenized shares are a representation of equity and are subject to securities rules where you operate. Production listings must pass issuer KYB and legal review.</span></p>`}
        </div>`;
        const grid = u.$('#l-grid', root);
        function draw() {
          let L = PT.launch.list().filter((t) => t.kind === kind);
          if (filter === 'new') L = L.sort((a, b) => b.created - a.created);
          else if (filter === 'verified') L = L.filter((t) => t.verified);
          else if (filter === 'mine') L = L.filter((t) => t.creator === 'you');
          else L = L.sort((a, b) => b.vol - a.vol);
          u.$$('#l-f button', root).forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
          grid.innerHTML = L.length ? L.map((t) => card(t)).join('') : `<p class="muted pad">${T.empty}</p>`;
        }
        function card(t) {
          const ch = price(t) / t.p0 - 1;
          const tile = t.kind === 'meme' ? `<span class="tile" style="--h:${t.hue}">${t.emoji}</span>` : `<span class="tile" style="--h:${t.hue}">${u.esc(t.sym.slice(0, 2))}</span>`;
          return `<button class="card token" data-id="${t.id}">
            <div class="row">${tile}<div class="grow"><b>${u.esc(t.name)}</b><div class="muted small">${u.esc(t.sym)}${t.meta.sector ? ' · ' + u.esc(t.meta.sector) : ''}</div></div>
            ${t.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Unverified</span>'}</div>
            <div class="row between"><div><small class="muted">Price</small><div><b>$${u.price(price(t))}</b></div></div><div class="right"><small class="muted">Since launch</small><div class="${u.dir(ch)}"><b>${u.pct(ch)}</b></div></div></div>
            <div class="row between small"><span class="muted">Market cap ${u.usd(mcap(t), 0)}</span><span class="muted">${t.graduated ? 'Graduated' : Math.round(progress(t) * 100) + '% to graduation'}</span></div>
            <div class="bar"><i style="width:${progress(t) * 100}%"></i></div></button>`;
        }
        u.$('#l-f', root).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } };
        grid.onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openToken(c.dataset.id); };
        u.$('#l-new', root).onclick = () => openCreate(kind, (t) => { filter = 'mine'; draw(); openToken(t.id); });
        let n = 0;
        const off = PT.bus.on('tick', () => { if (n++ % 3 === 0) draw(); });
        draw();
        return off;
      },
    };
  }
  PT.views.meme = view('meme');
  PT.views.ipo = view('ipo');

  /* ---------- create ---------- */
  function openCreate(kind, done) {
    const isMeme = kind === 'meme', L = cfg.launch, feeRate = isMeme ? cfg.fees.launchMeme : cfg.fees.launchIpo;
    const minSeed = isMeme ? L.memeMinSeed : L.ipoMinSeed;
    const presets = isMeme ? [100, 500, 1000, 5000] : [10000, 50000, 100000, 500000];
    let emoji = EMOJI[0];
    const m = PT.ui.modal({
      title: isMeme ? 'Launch a memecoin' : 'List a company', size: 'md',
      html: `<div class="stack">
        ${isMeme ? `<label class="field"><span>Coin name</span><input class="input" id="c-name" maxlength="32" placeholder="Moon Cat"></label>`
          : `<label class="field"><span>Registered company name</span><input class="input" id="c-name" maxlength="48" placeholder="Nova Grid Energy Ltd"></label>`}
        <div class="row"><label class="field grow"><span>Ticker (3 to 8 characters)</span><input class="input" id="c-sym" maxlength="8" placeholder="${isMeme ? 'MCAT' : 'NVGE'}"></label>
        ${isMeme ? '' : `<label class="field grow"><span>Sector</span><select class="input" id="c-sector">${SECTORS.map((s) => `<option>${s}</option>`).join('')}</select></label>`}</div>
        ${isMeme ? `<div class="field"><span>Icon</span><div class="emojis" id="c-emoji">${EMOJI.map((e, i) => `<button type="button" class="${i ? '' : 'on'}" data-e="${e}" aria-label="Icon ${e}">${e}</button>`).join('')}</div></div>
          <label class="field"><span>Description</span><textarea class="input" id="c-desc" rows="2" maxlength="160" placeholder="What is this coin about?"></textarea></label>`
          : `<div class="row"><label class="field grow"><span>Jurisdiction</span><input class="input" id="c-jur" maxlength="40" placeholder="Country of incorporation"></label>
          <label class="field grow"><span>Registration number</span><input class="input" id="c-reg" maxlength="30"></label></div>
          <div class="row"><label class="field grow"><span>Website</span><input class="input" id="c-web" placeholder="https://"></label>
          <label class="field grow"><span>Shares offered</span><select class="input" id="c-sup">${L.ipoShareOptions.map((s) => `<option value="${s}" ${s === 1000000 ? 'selected' : ''}>${s.toLocaleString()}</option>`).join('')}</select></label></div>`}
        <div class="field"><span>${isMeme ? 'Seed amount' : 'Listing amount'} (USDT). A higher amount sets a higher starting price.</span>
          <input class="input" id="c-seed" inputmode="decimal" value="${presets[1]}">
          <div class="pcts">${presets.map((p) => `<button type="button" class="chip" data-seed="${p}">${u.usd(p, 0)}</button>`).join('')}</div></div>
        <div class="card inset stack small" id="c-prev"></div>
        ${isMeme ? '' : `<label class="check"><input type="checkbox" id="c-auth"><span>I am authorised to list this company and can provide KYB documents on request.</span></label>`}
        <button class="btn primary block" id="c-go">${isMeme ? 'Launch coin' : 'List company'}</button></div>`,
    });
    const g = (id) => u.$(id, m.body);
    const supply = () => (isMeme ? L.memeSupply : +g('#c-sup').value);
    const seed = () => parseFloat(g('#c-seed').value) || 0;
    function prev() {
      const s = seed(), sup = supply(), fee = Math.max(isMeme ? 1 : 0, s * feeRate);
      g('#c-prev').innerHTML = `<div class="row between"><span class="muted">Starting price</span><b>$${u.price(s / sup)}</b></div>
        <div class="row between"><span class="muted">${isMeme ? 'Total supply' : 'Shares'}</span><b>${sup.toLocaleString()}</b></div>
        <div class="row between"><span class="muted">Starting market cap</span><b>${u.usd(s, 0)}</b></div>
        <div class="row between"><span class="muted">Launch fee (${(feeRate * 100).toFixed(0)}%)</span><b>${u.usd(fee)}</b></div>
        <div class="row between"><span>You pay</span><b>${u.usd(s + fee)}</b></div>`;
      return fee;
    }
    m.body.addEventListener('input', prev);
    m.body.addEventListener('click', (e) => {
      const em = e.target.closest('[data-e]'); if (em) { emoji = em.dataset.e; u.$$('#c-emoji button', m.body).forEach((b) => b.classList.toggle('on', b === em)); }
      const ch = e.target.closest('[data-seed]'); if (ch) { g('#c-seed').value = ch.dataset.seed; prev(); }
    });
    prev();
    g('#c-go').onclick = () => {
      const name = g('#c-name').value.trim(), sym = g('#c-sym').value.trim().toUpperCase(), s = seed(), fee = prev();
      if (name.length < 2) return PT.ui.toast('Enter a name.', 'err');
      if (!/^[A-Z0-9]{3,8}$/.test(sym)) return PT.ui.toast('Ticker must be 3 to 8 letters or numbers.', 'err');
      if (PT.launch.list().some((t) => t.sym === sym && t.kind === kind)) return PT.ui.toast('That ticker is already taken.', 'err');
      if (s < minSeed) return PT.ui.toast(`Minimum ${isMeme ? 'seed' : 'listing amount'} is ${u.usd(minSeed, 0)}.`, 'err');
      const meta = {};
      if (!isMeme) {
        if (!g('#c-auth').checked) return PT.ui.toast('Confirm you are authorised to list this company.', 'err');
        const web = g('#c-web').value.trim();
        if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(web)) return PT.ui.toast('Enter the company website starting with https://', 'err');
        if (!g('#c-jur').value.trim() || !g('#c-reg').value.trim()) return PT.ui.toast('Jurisdiction and registration number are required.', 'err');
        Object.assign(meta, { sector: g('#c-sector').value, jurisdiction: g('#c-jur').value.trim(), reg: g('#c-reg').value.trim(), website: web });
      }
      if (!PT.store.debit('USDT', s + fee)) return PT.ui.toast('Not enough USDT. Deposit to continue.', 'err');
      const t = makeToken({ kind, name, sym, emoji, hue: Math.floor(Math.random() * 360), desc: isMeme ? g('#c-desc').value.trim() : name + ' tokenized equity offering.', seed: s, supply: supply(), meta });
      PT.store.s.launches.unshift(t);
      PT.store.log('launch', `Launched ${name} (${sym}) with ${u.usd(s, 0)} seed`);
      PT.store.commit(); m.close(); PT.ui.toast(`${sym} is live.`, 'ok'); done(t);
    };
  }

  /* ---------- token detail + trade ---------- */
  function openToken(id) {
    const t = PT.launch.list().find((x) => x.id === id); if (!t) return;
    const S = PT.store, isMeme = t.kind === 'meme';
    let mode = 'buy';
    const m = PT.ui.modal({
      title: `${t.name} (${t.sym})`, size: 'lg', onClose: () => { off(); chart.destroy(); },
      html: `<div class="tokgrid">
        <div class="stack">
          <div class="row between"><div><div class="big-price" id="t-price"></div><div id="t-chg"></div></div>
            <div>${t.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Unverified</span>'}</div></div>
          <div class="card chartcard sm"><canvas id="t-cv" aria-label="Price chart"></canvas></div>
          <div class="stats" id="t-stats"></div>
          <div><div class="row between small"><span class="muted">${t.graduated ? 'Graduated to open liquidity' : 'Progress to graduation'}</span><span id="t-prog"></span></div><div class="bar"><i id="t-bar"></i></div></div>
          ${t.desc ? `<p class="muted">${u.esc(t.desc)}</p>` : ''}
          ${t.meta.website ? `<p class="small muted">${u.esc(t.meta.sector || '')} · ${u.esc(t.meta.jurisdiction || '')} · <a href="${u.esc(t.meta.website)}" target="_blank" rel="noopener noreferrer">Website</a></p>` : ''}
        </div>
        <div class="card inset stack">
          <div class="seg full big" id="t-sides"><button data-m="buy" class="buy">Buy</button><button data-m="sell" class="sell">Sell</button></div>
          <div class="row between small"><span class="muted">Available</span><b id="t-av"></b></div>
          <label class="field"><span id="t-lbl"></span><input class="input" id="t-amt" inputmode="decimal" placeholder="0.00"></label>
          <div class="pcts" id="t-chips"></div>
          <div class="small stack" id="t-quote"></div>
          <button class="btn block big" id="t-go"></button>
          <div class="small muted" id="t-pos"></div>
        </div></div>`,
    });
    const g = (sel) => u.$(sel, m.body);
    const chart = PT.chart.mount(g('#t-cv'), () => ({ type: 'line', data: t.hist }), { maxBars: 120 });
    const hold = () => S.s.holdings[t.id] || 0;
    function stats() {
      const ch = price(t) / t.p0 - 1;
      g('#t-price').textContent = '$' + u.price(price(t)); g('#t-chg').className = u.dir(ch); g('#t-chg').textContent = u.pct(ch) + ' since launch';
      g('#t-stats').innerHTML = [['Market cap', u.usd(mcap(t), 0)], ['Volume', u.usd(t.vol, 0)], ['Curve liquidity', u.usd(t.x, 0)], ['Holders', t.holders.toLocaleString()], [isMeme ? 'Supply' : 'Shares', u.compact(t.supply)], ['Creator', t.creator === 'you' ? 'You' : t.creator]].map(([a, b]) => `<div><small class="muted">${a}</small><b>${b}</b></div>`).join('');
      g('#t-prog').textContent = t.graduated ? '100%' : Math.round(progress(t) * 100) + '%'; g('#t-bar').style.width = progress(t) * 100 + '%';
      g('#t-pos').textContent = hold() > 0 ? `Your position: ${u.qty(hold())} ${t.sym} (${u.usd(hold() * price(t))})` : '';
    }
    function form() {
      const buy = mode === 'buy';
      u.$$('#t-sides button', m.body).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      g('#t-lbl').textContent = buy ? 'Amount to spend (USDT)' : `Amount to sell (${t.sym})`;
      g('#t-av').textContent = buy ? u.usd(S.bal('USDT')) : u.qty(hold()) + ' ' + t.sym;
      g('#t-chips').innerHTML = (buy ? [10, 50, 100, 500] : [25, 50, 75, 100]).map((v) => `<button class="chip" data-v="${v}">${buy ? '$' + v : v + '%'}</button>`).join('');
      const go = g('#t-go'); go.className = 'btn block big ' + (buy ? 'up' : 'down'); go.textContent = (buy ? 'Buy ' : 'Sell ') + t.sym;
      quote();
    }
    function quote() {
      const a = parseFloat(g('#t-amt').value) || 0;
      if (!a) { g('#t-quote').innerHTML = `<span class="muted">Fee ${(cfg.fees.curve * 100).toFixed(0)}% on every trade.</span>`; return; }
      if (mode === 'buy') { const q = quoteBuy(t, a); g('#t-quote').innerHTML = `<div class="row between"><span class="muted">You receive about</span><b>${u.qty(q.out)} ${t.sym}</b></div><div class="row between"><span class="muted">Price impact</span><b class="${q.impact > 0.05 ? 'down' : ''}">${(q.impact * 100).toFixed(2)}%</b></div>`; }
      else { const q = quoteSell(t, a); g('#t-quote').innerHTML = `<div class="row between"><span class="muted">You receive about</span><b>${u.usd(q.out)}</b></div><div class="row between"><span class="muted">Price impact</span><b class="${Math.abs(q.impact) > 0.05 ? 'down' : ''}">${(q.impact * 100).toFixed(2)}%</b></div>`; }
    }
    g('#t-sides').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { mode = b.dataset.m; g('#t-amt').value = ''; form(); } };
    g('#t-chips').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const v = +b.dataset.v; g('#t-amt').value = mode === 'buy' ? v : u.floorTo(hold() * v / 100, 6); quote(); };
    g('#t-amt').oninput = quote;
    g('#t-go').onclick = () => {
      const a = parseFloat(g('#t-amt').value) || 0;
      if (!(a > 0)) return PT.ui.toast('Enter an amount.', 'err');
      if (mode === 'buy') {
        if (a < 1) return PT.ui.toast('Minimum buy is 1 USDT.', 'err');
        if (!S.debit('USDT', a)) return PT.ui.toast('Not enough USDT.', 'err');
        const r = applyBuy(t, a); S.s.holdings[t.id] = hold() + r.out; if (!hold() || hold() === r.out) t.holders++;
        S.log('trade', `Bought ${u.qty(r.out)} ${t.sym} for ${u.usd(a)}`, { side: 'buy' }); PT.ui.toast(`Bought ${u.qty(r.out)} ${t.sym}`, 'ok');
      } else {
        if (a > hold() + 1e-9) return PT.ui.toast(`You only hold ${u.qty(hold())} ${t.sym}.`, 'err');
        const r = applySell(t, a); S.s.holdings[t.id] = Math.max(0, hold() - a); S.credit('USDT', r.out);
        S.log('trade', `Sold ${u.qty(a)} ${t.sym} for ${u.usd(r.out)}`, { side: 'sell' }); PT.ui.toast(`Sold for ${u.usd(r.out)}`, 'ok');
      }
      g('#t-amt').value = ''; S.commit(); stats(); form();
    };
    const off = PT.bus.on('tick', () => { stats(); chart.redraw(); if (document.activeElement !== g('#t-amt')) g('#t-av').textContent = mode === 'buy' ? u.usd(S.bal('USDT')) : u.qty(hold()) + ' ' + t.sym; });
    stats(); form();
  }
})();
