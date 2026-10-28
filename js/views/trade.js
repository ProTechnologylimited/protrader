/* Trade view: markets list, chart, order book, order form, orders/holdings. */
(function () {
  const PT = window.PT, u = PT.u;
  const CLS = { crypto: 'Crypto', commodity: 'Commodities', stock: 'Stocks' };

  PT.views.trade = {
    mount(root, params) {
      let sym = (params[0] || 'BTC').toUpperCase();
      if (!PT.market.get(sym)) sym = 'BTC';
      let tab = PT.market.get(sym).cls, query = '', side = 'buy', otype = 'market', btab = 'orders';

      root.innerHTML = `<div class="trade">
        <aside class="card mlist" id="mlist">
          <div class="seg full" id="ctabs">${Object.entries(CLS).map(([k, v]) => `<button data-c="${k}">${v}</button>`).join('')}</div>
          <label class="searchbox">${PT.icon('search', 16)}<input class="input" id="msearch" placeholder="Search markets" aria-label="Search markets"></label>
          <div class="mrows" id="mrows"></div>
        </aside>
        <section class="center">
          <div class="card head">
            <button class="btn ghost" id="picker" aria-label="Choose market"><b id="h-sym"></b><span class="muted">/USDT</span>${PT.icon('chevron', 16)}</button>
            <div class="hprice"><b id="h-price"></b><span id="h-chg"></span></div>
            <div class="hstats"><div><small class="muted">24h high</small><span id="h-hi"></span></div><div><small class="muted">24h low</small><span id="h-lo"></span></div><div><small class="muted">Type</small><span id="h-cls"></span></div></div>
          </div>
          <div class="card chartcard"><canvas id="cv" aria-label="Price chart"></canvas></div>
          <div class="lower">
            <div class="card book" id="book"></div>
            <div class="card panel">
              <div class="seg" id="btabs"><button data-b="orders">Open orders</button><button data-b="hold">Holdings</button><button data-b="hist">History</button></div>
              <div id="bbody" class="scrollx"></div>
            </div>
          </div>
        </section>
        <aside class="card oform" id="oform"></aside>
      </div>`;
      const g = (id) => u.$(id, root);

      /* ----- markets list ----- */
      function rows() {
        const list = PT.market.assets.filter((a) => a.cls === tab && (a.sym + a.name).toLowerCase().includes(query));
        g('#mrows').innerHTML = list.map((a) => {
          const c = PT.market.change(a);
          return `<button class="mrow ${a.sym === sym ? 'on' : ''}" data-s="${a.sym}"><span><b>${a.sym}</b><small class="muted">${u.esc(a.name)}</small></span><span class="right"><b>${u.price(a.price)}</b><small class="${u.dir(c)}">${u.pct(c)}</small></span></button>`;
        }).join('') || '<p class="muted pad">No markets match.</p>';
        u.$$('#ctabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.c === tab));
      }
      g('#ctabs').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { tab = b.dataset.c; rows(); } };
      g('#msearch').oninput = (e) => { query = e.target.value.toLowerCase(); rows(); };
      g('#mrows').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { location.hash = '#/trade/' + b.dataset.s; } };
      g('#picker').onclick = () => g('#mlist').classList.toggle('open');

      /* ----- header + chart ----- */
      const A = () => PT.market.get(sym);
      const chart = PT.chart.mount(g('#cv'), () => ({ type: 'candles', data: A().candles }), { maxBars: 70 });
      function head() {
        const a = A(), c = PT.market.change(a);
        g('#h-sym').textContent = a.sym;
        g('#h-price').textContent = u.price(a.price);
        g('#h-price').className = u.dir(c);
        g('#h-chg').textContent = u.pct(c); g('#h-chg').className = 'pill ' + u.dir(c);
        g('#h-hi').textContent = u.price(PT.market.hi24(a)); g('#h-lo').textContent = u.price(PT.market.lo24(a));
        g('#h-cls').textContent = CLS[a.cls];
      }

      /* ----- order book (simulated depth) ----- */
      function book() {
        const a = A(), step = a.price * 0.0002, mk = (dir) => Array.from({ length: 7 }, (_, i) => ({ p: a.price + dir * step * (i + 1), q: (Math.random() * 3 + 0.2) * (a.price > 1000 ? 0.05 : a.price > 50 ? 1 : 100) }));
        const asks = mk(1).reverse(), bids = mk(-1), mx = Math.max(...asks.concat(bids).map((r) => r.q));
        const line = (r, d) => `<div class="bl"><i class="${d}" style="width:${(r.q / mx) * 100}%"></i><span class="${d}">${u.price(r.p)}</span><span>${u.qty(r.q)}</span></div>`;
        g('#book').innerHTML = `<div class="bl h"><span>Price</span><span>Size (${a.sym})</span></div>${asks.map((r) => line(r, 'down')).join('')}<div class="mid ${u.dir(PT.market.change(a))}">${u.price(a.price)}</div>${bids.map((r) => line(r, 'up')).join('')}`;
      }

      /* ----- order form ----- */
      g('#oform').innerHTML = `<div class="seg full big" id="sides"><button data-sd="buy" class="buy">Buy</button><button data-sd="sell" class="sell">Sell</button></div>
        <div class="seg sm" id="types"><button data-t="market">Market</button><button data-t="limit">Limit</button></div>
        <div class="avail row between"><span class="muted">Available</span><b id="f-av"></b></div>
        <label class="field" id="f-pxw"><span>Price (USDT)</span><input class="input" id="f-px" inputmode="decimal"></label>
        <label class="field"><span>Amount (<em id="f-base"></em>)</span><input class="input" id="f-qty" inputmode="decimal" placeholder="0.00"></label>
        <div class="pcts" id="pcts">${[25, 50, 75, 100].map((p) => `<button class="chip" data-p="${p}">${p}%</button>`).join('')}</div>
        <div class="sum"><div class="row between"><span class="muted">Order value</span><b id="f-tot">0.00</b></div><div class="row between"><span class="muted">Fee (${(PT.config.fees.spot * 100).toFixed(1)}%)</span><b id="f-fee">0.00</b></div></div>
        <button class="btn block big" id="f-go"></button>`;
      const px = g('#f-px'), qty = g('#f-qty');
      const execPx = () => (otype === 'limit' ? parseFloat(px.value) || 0 : A().price);
      function form() {
        const a = A(), buy = side === 'buy';
        u.$$('#sides button', root).forEach((b) => b.classList.toggle('on', b.dataset.sd === side));
        u.$$('#types button', root).forEach((b) => b.classList.toggle('on', b.dataset.t === otype));
        g('#f-pxw').style.display = otype === 'limit' ? '' : 'none';
        g('#f-base').textContent = a.sym;
        g('#f-av').textContent = buy ? u.usd(PT.store.bal('USDT')) : u.qty(PT.store.bal(a.sym)) + ' ' + a.sym;
        const go = g('#f-go'); go.className = 'btn block big ' + (buy ? 'up' : 'down'); go.textContent = `${buy ? 'Buy' : 'Sell'} ${a.sym}`;
        totals();
      }
      function totals() {
        const v = execPx() * (parseFloat(qty.value) || 0);
        g('#f-tot').textContent = u.usd(v); g('#f-fee').textContent = u.usd(v * PT.config.fees.spot, 4);
      }
      g('#sides').onclick = (e) => { const b = e.target.closest('[data-sd]'); if (b) { side = b.dataset.sd; qty.value = ''; form(); } };
      g('#types').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { otype = b.dataset.t; if (otype === 'limit' && !px.value) px.value = +A().price.toPrecision(7); form(); } };
      px.oninput = qty.oninput = totals;
      g('#pcts').onclick = (e) => {
        const b = e.target.closest('[data-p]'); if (!b) return; const f = b.dataset.p / 100, a = A();
        const q = side === 'buy' ? PT.store.bal('USDT') / (execPx() * (1 + PT.config.fees.spot)) * f : PT.store.bal(a.sym) * f;
        qty.value = q > 0 ? u.floorTo(q, 6) : ''; totals();
      };
      g('#f-go').onclick = () => {
        const q = parseFloat(qty.value) || 0;
        const r = otype === 'market' ? PT.trading.market(sym, side, q) : PT.trading.limit(sym, side, q, parseFloat(px.value));
        PT.ui.toast(r.msg, r.ok ? 'ok' : 'err');
        if (r.ok) { qty.value = ''; form(); bottom(); }
      };

      /* ----- bottom panel ----- */
      function bottom() {
        const S = PT.store.s; u.$$('#btabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.b === btab));
        let h = '';
        if (btab === 'orders') {
          h = S.orders.length ? `<table class="tbl"><thead><tr><th>Market</th><th>Side</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>${S.orders.map((o) => `<tr><td>${o.sym}/USDT</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side}</td><td>${u.price(o.price)}</td><td>${u.qty(o.qty)}</td><td><button class="btn ghost sm" data-cancel="${o.id}">Cancel</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted pad">No open orders. Place a limit order to see it here.</p>';
        } else if (btab === 'hold') {
          const hs = Object.entries(S.balances).filter(([k, v]) => k !== 'USDT' && v > 1e-9 && PT.market.get(k));
          h = hs.length ? `<table class="tbl"><thead><tr><th>Asset</th><th>Amount</th><th>Value</th></tr></thead><tbody>${hs.map(([k, v]) => `<tr><td>${k}</td><td>${u.qty(v)}</td><td>${u.usd(v * PT.market.get(k).price)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted pad">You do not hold any market assets yet.</p>';
        } else {
          const hs = S.history.filter((x) => x.type === 'trade').slice(0, 15);
          h = hs.length ? `<table class="tbl"><tbody>${hs.map((x) => `<tr><td class="${x.side === 'buy' ? 'up' : 'down'}">${u.esc(x.text)}</td><td class="muted right">${u.timeAgo(x.t)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted pad">No trades yet.</p>';
        }
        g('#bbody').innerHTML = h;
      }
      g('#btabs').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) { btab = b.dataset.b; bottom(); } };
      g('#bbody').onclick = (e) => { const b = e.target.closest('[data-cancel]'); if (b) { PT.trading.cancel(b.dataset.cancel); } };

      /* ----- live updates ----- */
      let n = 0;
      const offTick = PT.bus.on('tick', () => { head(); rows(); chart.redraw(); if (n++ % 2 === 0) book(); if (otype === 'market') totals(); if (document.activeElement !== qty && document.activeElement !== px) g('#f-av').textContent = side === 'buy' ? u.usd(PT.store.bal('USDT')) : u.qty(PT.store.bal(sym)) + ' ' + sym; });
      const offState = PT.bus.on('state', () => { form(); bottom(); });
      rows(); head(); book(); form(); bottom();
      return () => { offTick(); offState(); chart.destroy(); };
    },
  };
})();
