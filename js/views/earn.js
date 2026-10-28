/* Earn: flexible/locked staking and launchpool. Demo clock: 1 minute = 1 day. */
(function () {
  const PT = window.PT, u = PT.u, cfg = PT.config;
  const day = () => cfg.demoDayMs;
  const STAKE = [
    { sym: 'USDT', terms: [[0, 5.5], [30, 9], [90, 14]] },
    { sym: 'ETH', terms: [[0, 2.8], [30, 4.2], [90, 5.6]] },
    { sym: 'SOL', terms: [[0, 6], [30, 7.4], [90, 8.8]] },
    { sym: 'BTC', terms: [[0, 0.8], [30, 1.4], [90, 2.1]] },
    { sym: 'BNB', terms: [[0, 2], [30, 3.5], [90, 5]] },
  ];
  const POOLS = [
    { id: 'lp1', project: 'Orbit Finance', reward: 'ORBT', stake: 'USDT', daily: 50000, total: 4000000, days: 14 },
    { id: 'lp2', project: 'Kryo Network', reward: 'KRYO', stake: 'ETH', daily: 20000, total: 900, days: 10 },
    { id: 'lp3', project: 'Lumen Pay', reward: 'LMNP', stake: 'SOL', daily: 12000, total: 150000, days: 21 },
  ];
  const elapsedDays = (t) => (Date.now() - t) / day();
  const stakeReward = (p) => p.amount * (p.apr / 100) * (elapsedDays(p.start) / 365) - p.claimed;
  const poolReward = (p) => { const d = POOLS.find((x) => x.id === p.pool); const share = p.amount / (d.total + p.amount); return share * d.daily * Math.min(elapsedDays(p.start), d.days) - p.claimed; };

  PT.earn = { stakeReward, poolReward };

  PT.views.earn = {
    mount(root) {
      let tab = 'stake';
      root.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Earn</h1><p class="muted lead">Stake assets for yield or farm new tokens in launchpools.</p></div></div>
        <div class="seg" id="e-t"><button data-t="stake">Staking</button><button data-t="pool">Launchpool</button></div>
        <p class="note">${PT.icon('alert', 16)}<span>Demo clock: 1 minute equals 1 day, so rewards and lock periods are easy to try. Yields are examples and are not guaranteed.</span></p>
        <div id="e-body"></div></div>`;
      const body = u.$('#e-body', root);

      function draw() {
        u.$$('#e-t button', root).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
        const S = PT.store.s;
        if (tab === 'stake') {
          const mine = S.staking;
          body.innerHTML = `<div class="cards">${STAKE.map((p) => `<div class="card stack"><div class="row between"><b>${p.sym}</b><span class="pill up">up to ${Math.max(...p.terms.map((t) => t[1]))}% APR</span></div>
            <div class="small muted">${p.terms.map(([d, a]) => `${d ? d + 'd' : 'Flexible'} ${a}%`).join(' · ')}</div>
            <button class="btn primary block" data-stake="${p.sym}">Stake ${p.sym}</button></div>`).join('')}</div>
            <h2 class="sub">Your positions</h2>
            ${mine.length ? `<div class="scrollx"><table class="tbl"><thead><tr><th>Asset</th><th>Staked</th><th>APR</th><th>Rewards</th><th>Status</th><th></th></tr></thead><tbody>${mine.map((p) => {
              const left = p.lock ? Math.max(0, p.lock - elapsedDays(p.start)) : 0;
              return `<tr><td>${p.sym}</td><td>${u.qty(p.amount)}</td><td>${p.apr}%</td><td class="up">${u.qty(Math.max(0, stakeReward(p)))} ${p.sym}</td>
                <td>${left > 0 ? 'Unlocks in ' + left.toFixed(1) + 'd' : p.lock ? 'Matured' : 'Flexible'}</td>
                <td class="nowrap"><button class="btn ghost sm" data-claim="${p.id}">Claim</button> <button class="btn ghost sm" data-unstake="${p.id}" ${left > 0 ? 'disabled' : ''}>Unstake</button></td></tr>`;
            }).join('')}</tbody></table></div>` : '<p class="muted pad">No staking positions yet.</p>'}`;
        } else {
          const mine = S.pool;
          body.innerHTML = `<div class="cards">${POOLS.map((d) => `<div class="card stack"><div class="row between"><div><b>${u.esc(d.project)}</b><div class="small muted">Stake ${d.stake} · earn ${d.reward}</div></div><span class="badge ok">Verified</span></div>
            <div class="row between small"><span class="muted">Daily rewards</span><b>${d.daily.toLocaleString()} ${d.reward}</b></div>
            <div class="row between small"><span class="muted">Total staked</span><b>${u.compact(d.total)} ${d.stake}</b></div>
            <div class="row between small"><span class="muted">Duration</span><b>${d.days} days</b></div>
            <button class="btn primary block" data-pool="${d.id}">Stake ${d.stake}</button></div>`).join('')}</div>
            <h2 class="sub">Your launchpool stakes</h2>
            ${mine.length ? `<div class="scrollx"><table class="tbl"><thead><tr><th>Pool</th><th>Staked</th><th>Pending</th><th></th></tr></thead><tbody>${mine.map((p) => { const d = POOLS.find((x) => x.id === p.pool); return `<tr><td>${u.esc(d.project)}</td><td>${u.qty(p.amount)} ${d.stake}</td><td class="up">${u.qty(Math.max(0, poolReward(p)))} ${d.reward}</td><td class="nowrap"><button class="btn ghost sm" data-pclaim="${p.id}">Claim</button> <button class="btn ghost sm" data-pout="${p.id}">Withdraw</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted pad">No launchpool stakes yet.</p>'}`;
        }
      }
      u.$('#e-t', root).onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; draw(); } };
      body.onclick = (e) => {
        const S = PT.store, st = S.s, d = (k) => e.target.closest('[' + k + ']');
        let b;
        if ((b = d('data-stake'))) return stakeModal(STAKE.find((x) => x.sym === b.dataset.stake));
        if ((b = d('data-pool'))) return poolModal(POOLS.find((x) => x.id === b.dataset.pool));
        if ((b = d('data-claim'))) { const p = st.staking.find((x) => x.id === b.dataset.claim), r = Math.max(0, stakeReward(p)); p.claimed += r; S.credit(p.sym, r); S.log('earn', `Claimed ${u.qty(r)} ${p.sym} staking rewards`); S.commit(); return PT.ui.toast(`Claimed ${u.qty(r)} ${p.sym}`, 'ok'); }
        if ((b = d('data-unstake'))) { const i = st.staking.findIndex((x) => x.id === b.dataset.unstake), p = st.staking[i], r = Math.max(0, stakeReward(p)); S.credit(p.sym, p.amount + r); st.staking.splice(i, 1); S.log('earn', `Unstaked ${u.qty(p.amount)} ${p.sym}`); S.commit(); return PT.ui.toast('Unstaked with rewards.', 'ok'); }
        if ((b = d('data-pclaim'))) { const p = st.pool.find((x) => x.id === b.dataset.pclaim), dd = POOLS.find((x) => x.id === p.pool), r = Math.max(0, poolReward(p)); p.claimed += r; S.credit(dd.reward, r); S.log('earn', `Claimed ${u.qty(r)} ${dd.reward} from launchpool`); S.commit(); return PT.ui.toast(`Claimed ${u.qty(r)} ${dd.reward}`, 'ok'); }
        if ((b = d('data-pout'))) { const i = st.pool.findIndex((x) => x.id === b.dataset.pout), p = st.pool[i], dd = POOLS.find((x) => x.id === p.pool), r = Math.max(0, poolReward(p)); S.credit(dd.stake, p.amount); S.credit(dd.reward, r); st.pool.splice(i, 1); S.log('earn', `Withdrew ${u.qty(p.amount)} ${dd.stake} from launchpool`); S.commit(); return PT.ui.toast('Withdrawn with rewards.', 'ok'); }
      };
      let n = 0;
      const off = PT.bus.on('tick', () => { if (n++ % 2 === 0) draw(); }), off2 = PT.bus.on('state', draw);
      draw();
      return () => { off(); off2(); };
    },
  };

  function stakeModal(p) {
    let term = p.terms[1];
    const m = PT.ui.modal({
      title: 'Stake ' + p.sym, size: 'sm',
      html: `<div class="stack"><div class="field"><span>Term</span><div class="seg full" id="k-t">${p.terms.map(([d, a], i) => `<button data-i="${i}" class="${i === 1 ? 'on' : ''}">${d ? d + ' days' : 'Flexible'}<small>${a}%</small></button>`).join('')}</div></div>
        <label class="field"><span>Amount <em class="muted">Available ${u.qty(PT.store.bal(p.sym))} ${p.sym}</em></span><input class="input" id="k-a" inputmode="decimal" placeholder="0.00"></label>
        <div class="card inset small row between"><span class="muted">Estimated yearly reward</span><b id="k-e">0</b></div>
        <button class="btn primary block" id="k-go">Confirm stake</button></div>`,
    });
    const a = u.$('#k-a', m.body), est = () => (u.$('#k-e', m.body).textContent = u.qty((parseFloat(a.value) || 0) * term[1] / 100) + ' ' + p.sym);
    u.$('#k-t', m.body).onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { term = p.terms[+b.dataset.i]; u.$$('#k-t button', m.body).forEach((x) => x.classList.toggle('on', x === b)); est(); } };
    a.oninput = est;
    u.$('#k-go', m.body).onclick = () => {
      const v = parseFloat(a.value) || 0;
      if (!(v > 0)) return PT.ui.toast('Enter an amount.', 'err');
      if (!PT.store.debit(p.sym, v)) return PT.ui.toast(`Not enough ${p.sym}. Buy or deposit first.`, 'err');
      PT.store.s.staking.push({ id: u.uid('st'), sym: p.sym, amount: v, apr: term[1], lock: term[0], start: Date.now(), claimed: 0 });
      PT.store.log('earn', `Staked ${u.qty(v)} ${p.sym} at ${term[1]}% APR`); PT.store.commit(); m.close(); PT.ui.toast('Staked.', 'ok');
    };
  }
  function poolModal(d) {
    const m = PT.ui.modal({
      title: `${d.project} launchpool`, size: 'sm',
      html: `<div class="stack"><p class="muted small">Stake ${d.stake} to earn ${d.reward}. Your share of the daily rewards is your stake divided by the pool total. You can withdraw anytime.</p>
        <label class="field"><span>Amount <em class="muted">Available ${u.qty(PT.store.bal(d.stake))} ${d.stake}</em></span><input class="input" id="p-a" inputmode="decimal" placeholder="0.00"></label>
        <button class="btn primary block" id="p-go">Stake ${d.stake}</button></div>`,
    });
    u.$('#p-go', m.body).onclick = () => {
      const v = parseFloat(u.$('#p-a', m.body).value) || 0;
      if (!(v > 0)) return PT.ui.toast('Enter an amount.', 'err');
      if (!PT.store.debit(d.stake, v)) return PT.ui.toast(`Not enough ${d.stake}.`, 'err');
      PT.store.s.pool.push({ id: u.uid('lp'), pool: d.id, amount: v, start: Date.now(), claimed: 0 });
      PT.store.log('earn', `Staked ${u.qty(v)} ${d.stake} in ${d.project} launchpool`); PT.store.commit(); m.close(); PT.ui.toast('Staked in launchpool.', 'ok');
    };
  }
})();
