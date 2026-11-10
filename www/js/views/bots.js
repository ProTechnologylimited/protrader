/* Trading bots (simulated): AI trend signal, grid and DCA. Bots run while the app is open. */
(function () {
  const PT = window.PT, u = PT.u, FEE = () => PT.config.fees.spot;

  const sma = (a, n) => { if (a.length < n) return null; let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; };
  const rsi = (a, n = 14) => { if (a.length < n + 1) return null; let g = 0, l = 0; for (let i = a.length - n; i < a.length; i++) { const d = a[i] - a[i - 1]; d >= 0 ? (g += d) : (l -= d); } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
  const equity = (b, p) => (b.status === 'stopped' ? b.final : b.cash + b.qty * p);

  function buy(b, usdt, p) {
    usdt = Math.min(usdt, b.cash); if (usdt < 1) return false;
    const q = (usdt * (1 - FEE())) / p; b.cash -= usdt; b.qty += q;
    b.entry = b.entry ? (b.entry * (b.qty - q) + p * q) / b.qty : p;
    note(b, 'Buy', q, p); return true;
  }
  function sell(b, q, p) {
    q = Math.min(q, b.qty); if (q <= 0) return false;
    b.cash += q * p * (1 - FEE()); b.qty -= q; if (b.qty < 1e-12) { b.qty = 0; b.entry = 0; }
    note(b, 'Sell', q, p); return true;
  }
  function note(b, side, q, p) { b.trades.unshift({ t: Date.now(), side, q, p }); if (b.trades.length > 30) b.trades.length = 30; b.count++; }

  function step(b, a) {
    const p = a.price; b.prices.push(p); if (b.prices.length > 60) b.prices.shift();
    if (b.strategy === 'ai') {
      const f = sma(b.prices, 5), s = sma(b.prices, 15), r = rsi(b.prices);
      if (f == null || s == null || r == null) return;
      const trend = f > s ? 1 : -1;
      if (b.qty > 0 && (p <= b.entry * (1 - b.sl / 100) || p >= b.entry * (1 + b.tp / 100))) { sell(b, b.qty, p); b.trend = trend; return; }
      if (b.trend === -1 && trend === 1 && r < 70 && b.qty === 0) buy(b, b.cash, p);
      else if (b.trend === 1 && trend === -1 && b.qty > 0) sell(b, b.qty, p);
      b.trend = trend;
    } else if (b.strategy === 'grid') {
      const n = b.grids, L = Array.from({ length: n + 1 }, (_, i) => b.lo + ((b.hi - b.lo) * i) / n);
      let idx = -1; for (let i = 0; i <= n; i++) if (p >= L[i]) idx = i;
      if (b.last == null) { b.last = idx; return; }
      if (idx < b.last) { for (let j = b.last; j > idx; j--) if (j < n && !b.lots[j]) { const per = b.invest / n; const before = b.qty; if (buy(b, per, L[j])) b.lots[j] = b.qty - before; } }
      else if (idx > b.last) { for (let j = b.last + 1; j <= idx; j++) { const lot = b.lots[j - 1]; if (lot) { sell(b, lot, L[j]); delete b.lots[j - 1]; } } }
      b.last = idx;
    } else if (b.strategy === 'dca') {
      b.tickN++;
      if (b.qty > 0 && p >= b.entry * (1 + b.tp / 100)) sell(b, b.qty, p);
      else if (b.tickN % b.every === 0 && b.cash >= 1) buy(b, Math.min(b.cash, b.invest / b.orders), p);
    }
  }

  PT.bus.on('tick', () => {
    const bots = PT.store.s.bots; let any = false;
    bots.forEach((b) => { if (b.status === 'running') { step(b, PT.market.get(b.sym)); any = true; } });
    if (any) PT.store.touch();
  });
  PT.bots = { equity, total: () => PT.store.s.bots.filter((b) => b.status === 'running').reduce((s, b) => s + equity(b, PT.market.get(b.sym).price), 0) };

  const STRATS = {
    ai: { name: 'AI trend', desc: 'Reads fast and slow moving averages plus RSI momentum, buys on bullish crossovers and exits on reversals, take-profit or stop-loss.' },
    grid: { name: 'Grid', desc: 'Places buy and sell levels across a price range and harvests small moves in sideways markets.' },
    dca: { name: 'DCA', desc: 'Buys a fixed amount at regular intervals and sells when your profit target is hit.' },
  };

  PT.views.bots = {
    mount(root) {
      let strat = 'ai';
      root.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Trading bots</h1><p class="muted lead">Automate a strategy on any market. Bots trade simulated prices while this page is open.</p></div></div>
        <div class="botgrid"><div class="card stack" id="b-form"></div><div class="stack" id="b-list"></div></div>
        <p class="note">${PT.icon('alert', 16)}<span>Bot results are simulated and do not predict real performance. Automated strategies can lose money, especially in fast markets.</span></p></div>`;
      const g = (id) => u.$(id, root);

      function form() {
        const mk = PT.market.assets;
        g('#b-form').innerHTML = `<h2 class="sub">New bot</h2>
          <div class="seg full" id="b-s">${Object.entries(STRATS).map(([k, v]) => `<button data-s="${k}" class="${k === strat ? 'on' : ''}">${v.name}</button>`).join('')}</div>
          <p class="small muted">${STRATS[strat].desc}</p>
          <label class="field"><span>Market</span><select class="input" id="b-sym">${mk.map((a) => `<option value="${a.sym}">${a.sym}/USDT</option>`).join('')}</select></label>
          <label class="field"><span>Investment (USDT) <em class="muted">Available ${u.usd(PT.store.bal('USDT'))}</em></span><input class="input" id="b-inv" inputmode="decimal" value="500"></label>
          ${strat === 'ai' ? `<div class="row"><label class="field grow"><span>Take profit %</span><input class="input" id="b-tp" value="1.5"></label><label class="field grow"><span>Stop loss %</span><input class="input" id="b-sl" value="1"></label></div>` : ''}
          ${strat === 'grid' ? `<div class="row"><label class="field grow"><span>Lower price</span><input class="input" id="b-lo"></label><label class="field grow"><span>Upper price</span><input class="input" id="b-hi"></label><label class="field grow"><span>Grids</span><input class="input" id="b-gr" value="8"></label></div><button class="btn ghost sm fit" id="b-auto">Fill range around current price (±2%)</button>` : ''}
          ${strat === 'dca' ? `<div class="row"><label class="field grow"><span>Buy every (seconds)</span><input class="input" id="b-ev" value="10"></label><label class="field grow"><span>Number of buys</span><input class="input" id="b-or" value="10"></label><label class="field grow"><span>Take profit %</span><input class="input" id="b-tp" value="1"></label></div>` : ''}
          <button class="btn primary block" id="b-go">Start bot</button>`;
        const auto = g('#b-auto'), sym = g('#b-sym');
        const fill = () => { const p = PT.market.get(sym.value).price; g('#b-lo').value = +(p * 0.98).toPrecision(6); g('#b-hi').value = +(p * 1.02).toPrecision(6); };
        if (auto) { auto.onclick = fill; sym.onchange = fill; fill(); }
        g('#b-s').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { strat = b.dataset.s; form(); } };
        g('#b-go').onclick = start;
      }
      function start() {
        const sym = g('#b-sym').value, inv = parseFloat(g('#b-inv').value) || 0, v = (id) => parseFloat((g(id) || {}).value);
        if (inv < 10) return PT.ui.toast('Minimum investment is 10 USDT.', 'err');
        const b = { id: u.uid('bot'), strategy: strat, sym, invest: inv, cash: inv, qty: 0, entry: 0, status: 'running', t: Date.now(), trades: [], count: 0, prices: [], tickN: 0 };
        if (strat === 'ai') { b.tp = v('#b-tp') || 1.5; b.sl = v('#b-sl') || 1; b.trend = null; }
        if (strat === 'grid') { b.lo = v('#b-lo'); b.hi = v('#b-hi'); b.grids = Math.round(v('#b-gr')); b.lots = {}; b.last = null; if (!(b.lo > 0 && b.hi > b.lo)) return PT.ui.toast('Upper price must be higher than lower price.', 'err'); if (!(b.grids >= 2 && b.grids <= 40)) return PT.ui.toast('Use between 2 and 40 grids.', 'err'); }
        if (strat === 'dca') { b.every = Math.max(2, Math.round(v('#b-ev') || 10)); b.orders = Math.max(2, Math.round(v('#b-or') || 10)); b.tp = v('#b-tp') || 1; }
        if (!PT.store.debit('USDT', inv)) return PT.ui.toast('Not enough USDT.', 'err');
        PT.store.s.bots.unshift(b); PT.store.log('bot', `Started ${STRATS[strat].name} bot on ${sym} with ${u.usd(inv, 0)}`); PT.store.commit(); PT.ui.toast('Bot started.', 'ok');
      }
      function list() {
        const bots = PT.store.s.bots;
        g('#b-list').innerHTML = bots.length ? bots.map((b) => {
          const p = PT.market.get(b.sym).price, eq = equity(b, p), pnl = eq - b.invest, running = b.status === 'running';
          return `<div class="card stack"><div class="row between"><div><b>${STRATS[b.strategy].name} · ${b.sym}/USDT</b><div class="small muted">${running ? 'Running' : 'Stopped'} · ${b.count} trades · started ${u.timeAgo(b.t)}</div></div><span class="pill ${u.dir(pnl)}">${u.pct(pnl / b.invest)}</span></div>
            <div class="stats"><div><small class="muted">Invested</small><b>${u.usd(b.invest)}</b></div><div><small class="muted">Value</small><b>${u.usd(eq)}</b></div><div><small class="muted">Profit</small><b class="${u.dir(pnl)}">${u.usd(pnl)}</b></div></div>
            <details class="small"><summary>Recent trades</summary>${b.trades.length ? `<table class="tbl"><tbody>${b.trades.slice(0, 8).map((t) => `<tr><td class="${t.side === 'Buy' ? 'up' : 'down'}">${t.side}</td><td>${u.qty(t.q)} ${b.sym}</td><td>${u.price(t.p)}</td><td class="muted right">${u.timeAgo(t.t)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Waiting for a signal.</p>'}</details>
            <div class="row end">${running ? `<button class="btn ghost sm" data-stop="${b.id}">Stop and sell</button>` : `<button class="btn ghost sm" data-del="${b.id}">Remove</button>`}</div></div>`;
        }).join('') : `<div class="card pad muted">No bots yet. Pick a strategy and start your first one.</div>`;
      }
      g('#b-list').onclick = (e) => {
        const S = PT.store, st = S.s.bots, s = e.target.closest('[data-stop]'), d = e.target.closest('[data-del]');
        if (s) { const b = st.find((x) => x.id === s.dataset.stop), p = PT.market.get(b.sym).price; if (b.qty > 0) sell(b, b.qty, p); b.final = b.cash; S.credit('USDT', b.cash); b.cash = 0; b.status = 'stopped'; S.log('bot', `Stopped ${STRATS[b.strategy].name} bot on ${b.sym}`); S.commit(); PT.ui.toast('Bot stopped. Funds returned to USDT.', 'ok'); }
        if (d) { st.splice(st.findIndex((x) => x.id === d.dataset.del), 1); S.commit(); }
      };
      let n = 0;
      const off = PT.bus.on('tick', () => { if (n++ % 2 === 0) list(); }), off2 = PT.bus.on('state', list);
      form(); list();
      return () => { off(); off2(); };
    },
  };
})();
