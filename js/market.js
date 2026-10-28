/* Simulated market feed + spot trading engine (market & limit orders). */
(function () {
  const PT = window.PT, u = PT.u;

  const defs = [
    ['BTC', 'Bitcoin', 'crypto', 67250, 0.0009],
    ['ETH', 'Ethereum', 'crypto', 3480, 0.0011],
    ['SOL', 'Solana', 'crypto', 172, 0.0016],
    ['BNB', 'BNB', 'crypto', 585, 0.001],
    ['XRP', 'XRP', 'crypto', 0.53, 0.0014],
    ['DOGE', 'Dogecoin', 'crypto', 0.158, 0.002],
    ['XAU', 'Gold', 'commodity', 2385, 0.0004],
    ['XAG', 'Silver', 'commodity', 28.4, 0.0007],
    ['WTI', 'Crude oil', 'commodity', 78.6, 0.0009],
    ['AAPL', 'Apple', 'stock', 224, 0.0007],
    ['NVDA', 'NVIDIA', 'stock', 118, 0.0014],
    ['TSLA', 'Tesla', 'stock', 248, 0.0016],
    ['MSFT', 'Microsoft', 'stock', 428, 0.0006],
  ];
  const TICKS_PER_CANDLE = 8;

  const assets = defs.map(([sym, name, cls, base, vol]) => {
    // build history ending at `base`
    const n = 120, closes = [base];
    for (let i = 1; i < n; i++) closes.unshift(closes[0] / (1 + u.gauss() * vol * Math.sqrt(TICKS_PER_CANDLE)));
    const candles = closes.map((c, i) => {
      const o = i ? closes[i - 1] : c, hi = Math.max(o, c) * (1 + Math.random() * vol * 2), lo = Math.min(o, c) * (1 - Math.random() * vol * 2);
      return { o, h: hi, l: lo, c };
    });
    const open24 = closes[0];
    return { sym, name, cls, base, vol, price: base, open24, candles, n: 0, target: null };
  });
  const bySym = Object.fromEntries(assets.map((a) => [a.sym, a]));

  PT.market = {
    assets,
    get: (sym) => bySym[sym],
    change: (a) => a.price / a.open24 - 1,
    hi24: (a) => Math.max(...a.candles.map((c) => c.h)),
    lo24: (a) => Math.min(...a.candles.map((c) => c.l)),
    tick() {
      assets.forEach((a) => {
        if (a.target) a.price += (a.target - a.price) * 0.35 + a.price * a.vol * 0.1 * u.gauss();
        else a.price *= 1 + u.gauss() * a.vol;
        const c = a.candles[a.candles.length - 1];
        c.c = a.price; c.h = Math.max(c.h, a.price); c.l = Math.min(c.l, a.price);
        if (++a.n % TICKS_PER_CANDLE === 0) {
          a.candles.push({ o: a.price, h: a.price, l: a.price, c: a.price });
          if (a.candles.length > 240) a.candles.shift();
        }
      });
      PT.trading.sweep();
      PT.bus.emit('tick');
    },
    start() {
      setInterval(() => PT.market.tick(), 1000);
      if (PT.config.liveCryptoFeed) this.connectBinance();
    },
    /* Optional real prices for crypto via Binance public stream. */
    connectBinance() {
      try {
        const streams = assets.filter((a) => a.cls === 'crypto').map((a) => a.sym.toLowerCase() + 'usdt@miniTicker').join('/');
        const ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
        ws.onmessage = (e) => {
          const d = JSON.parse(e.data).data; if (!d) return;
          const a = bySym[d.s.replace('USDT', '')];
          if (a) { a.target = parseFloat(d.c); if (a.price === a.base) a.price = a.target; }
        };
        ws.onclose = () => setTimeout(() => PT.market.connectBinance(), 5000);
      } catch (e) { console.warn('Live feed unavailable', e); }
    },
  };

  /* ---------- Spot trading engine ---------- */
  const fail = (msg) => ({ ok: false, msg });
  PT.trading = {
    market(sym, side, qty) {
      const a = bySym[sym], S = PT.store, fee = PT.config.fees.spot;
      if (!(qty > 0)) return fail('Enter an amount greater than zero.');
      const val = a.price * qty;
      if (side === 'buy') {
        if (!S.debit('USDT', val * (1 + fee))) return fail('Not enough USDT. Deposit more or lower the amount.');
        S.credit(sym, qty);
      } else {
        if (!S.debit(sym, qty)) return fail('Not enough ' + sym + ' to sell.');
        S.credit('USDT', val * (1 - fee));
      }
      S.log('trade', `${side === 'buy' ? 'Bought' : 'Sold'} ${u.qty(qty)} ${sym} at ${u.price(a.price)}`, { side });
      S.commit();
      return { ok: true, msg: `${side === 'buy' ? 'Bought' : 'Sold'} ${u.qty(qty)} ${sym}` };
    },
    limit(sym, side, qty, price) {
      const S = PT.store, fee = PT.config.fees.spot;
      if (!(qty > 0) || !(price > 0)) return fail('Enter a price and amount.');
      if (side === 'buy') { if (!S.debit('USDT', price * qty * (1 + fee))) return fail('Not enough USDT for this order.'); }
      else if (!S.debit(sym, qty)) return fail('Not enough ' + sym + ' to sell.');
      S.s.orders.push({ id: u.uid('o'), sym, side, qty, price, t: Date.now() });
      S.commit();
      return { ok: true, msg: 'Limit order placed' };
    },
    cancel(id) {
      const S = PT.store, i = S.s.orders.findIndex((o) => o.id === id);
      if (i < 0) return;
      const o = S.s.orders[i], fee = PT.config.fees.spot;
      if (o.side === 'buy') S.credit('USDT', o.price * o.qty * (1 + fee)); else S.credit(o.sym, o.qty);
      S.s.orders.splice(i, 1);
      S.commit();
    },
    sweep() {
      const S = PT.store, fee = PT.config.fees.spot;
      const list = S.s.orders; if (!list.length) return;
      let changed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i], a = bySym[o.sym];
        const hit = o.side === 'buy' ? a.price <= o.price : a.price >= o.price;
        if (!hit) continue;
        if (o.side === 'buy') S.credit(o.sym, o.qty); else S.credit('USDT', o.price * o.qty * (1 - fee));
        S.log('trade', `Limit ${o.side} filled: ${u.qty(o.qty)} ${o.sym} at ${u.price(o.price)}`, { side: o.side });
        PT.ui.toast(`Limit ${o.side} filled: ${u.qty(o.qty)} ${o.sym}`, 'ok');
        list.splice(i, 1); changed = true;
      }
      if (changed) S.commit();
    },
  };
})();
