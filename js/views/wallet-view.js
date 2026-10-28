/* Wallet / assets overview. */
(function () {
  const PT = window.PT, u = PT.u;

  /* Estimated total value of everything the user owns, in USDT. */
  PT.portfolio = {
    assets() {
      const S = PT.store.s, out = [];
      Object.entries(S.balances).forEach(([sym, v]) => {
        if (v <= 1e-9) return;
        const a = PT.market.get(sym), price = sym === 'USDT' ? 1 : a ? a.price : null;
        out.push({ sym, name: sym === 'USDT' ? 'Tether' : a ? a.name : 'Airdrop token', qty: v, price, value: price == null ? 0 : v * price });
      });
      Object.entries(S.holdings).forEach(([id, v]) => {
        const t = PT.launch.list().find((x) => x.id === id); if (!t || v <= 1e-9) return;
        out.push({ sym: t.sym, name: t.name, qty: v, price: PT.launch.price(t), value: v * PT.launch.price(t) });
      });
      return out;
    },
    earning() {
      const S = PT.store.s;
      return S.staking.reduce((s, p) => s + p.amount * (p.sym === 'USDT' ? 1 : PT.market.get(p.sym).price), 0) + PT.bots.total()
        + S.orders.reduce((s, o) => s + (o.side === 'buy' ? o.price * o.qty : o.qty * PT.market.get(o.sym).price), 0);
    },
    total() { return this.assets().reduce((s, a) => s + a.value, 0) + this.earning(); },
  };

  PT.views.wallet = {
    mount(root) {
      root.innerHTML = `<div class="page">
        <div class="pagehead"><div><h1>Wallet</h1><p class="muted lead">Your balances across spot, launches, staking and bots.</p></div>
        <div class="row"><button class="btn primary" id="w-dep">Deposit</button><button class="btn ghost" id="w-wd">Withdraw</button></div></div>
        <div class="card stack"><small class="muted">Estimated total value</small><div class="big-price" id="w-total"></div>
        <div class="stats" id="w-stats"></div></div>
        <h2 class="sub">Assets</h2><div class="card"><div class="scrollx"><table class="tbl" id="w-tbl"></table></div></div>
        <h2 class="sub">Activity</h2><div class="card"><div id="w-act"></div></div></div>`;
      u.$('#w-dep', root).onclick = () => PT.wallet.openDeposit();
      u.$('#w-wd', root).onclick = () => PT.wallet.openWithdraw();
      function draw() {
        const P = PT.portfolio, A = P.assets().sort((a, b) => b.value - a.value), S = PT.store.s;
        u.$('#w-total', root).textContent = u.usd(P.total());
        u.$('#w-stats', root).innerHTML = [['Available USDT', u.usd(PT.store.bal('USDT'))], ['Staked, in bots or orders', u.usd(P.earning())], ['Connected wallet', PT.wallet.connected() ? u.short(PT.wallet.address) + ' (' + PT.wallet.chain + ')' : 'Not connected']].map(([a, b]) => `<div><small class="muted">${a}</small><b>${b}</b></div>`).join('');
        u.$('#w-tbl', root).innerHTML = `<thead><tr><th>Asset</th><th>Amount</th><th>Price</th><th>Value</th></tr></thead><tbody>${A.map((a) => `<tr><td><b>${u.esc(a.sym)}</b> <span class="muted small">${u.esc(a.name)}</span></td><td>${u.qty(a.qty)}</td><td>${a.price == null ? '<span class="muted">Unpriced</span>' : '$' + u.price(a.price)}</td><td>${u.usd(a.value)}</td></tr>`).join('')}</tbody>`;
        u.$('#w-act', root).innerHTML = S.history.length ? `<table class="tbl"><tbody>${S.history.slice(0, 12).map((h) => `<tr><td>${u.esc(h.text)}</td><td class="muted right nowrap">${u.timeAgo(h.t)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted pad">Nothing yet. Deposit to get started.</p>';
      }
      const off = PT.bus.on('tick', draw), off2 = PT.bus.on('state', draw), off3 = PT.bus.on('wallet', draw);
      draw();
      return () => { off(); off2(); off3(); };
    },
  };
})();
