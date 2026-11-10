/* Airdrops: vetted campaigns with a legitimacy checklist + advertiser submission form. */
(function () {
  const PT = window.PT, u = PT.u;
  const DAY = 86400e3;

  const CHECKS = [
    ['audit', 'Smart contract audited by a recognised firm'],
    ['kyc', 'Team identity verified (KYC)'],
    ['socials', 'Official website and social accounts verified'],
    ['noApprovals', 'Claim never asks for wallet approvals or seed phrases'],
    ['tokenomics', 'Token supply and distribution published'],
  ];
  const CAMPAIGNS = [
    { id: 'ad1', project: 'Orbit Finance', sym: 'ORBT', per: 250, pool: 2000000, chain: 'Solana', days: 9, people: 18420, checks: { audit: 1, kyc: 1, socials: 1, noApprovals: 1, tokenomics: 1 }, tasks: [{ id: 'w', type: 'wallet', text: 'Connect a wallet' }, { id: 'b', type: 'balance', min: 50, text: 'Hold at least 50 USDT in your ProTrader balance' }, { id: 's', type: 'social', text: 'Follow the official Orbit Finance account', url: 'https://example.com' }] },
    { id: 'ad2', project: 'Kryo Network', sym: 'KRYO', per: 120, pool: 900000, chain: 'Ethereum', days: 4, people: 9310, checks: { audit: 1, kyc: 1, socials: 1, noApprovals: 1, tokenomics: 1 }, tasks: [{ id: 'w', type: 'wallet', text: 'Connect a wallet' }, { id: 's', type: 'social', text: 'Join the official community channel', url: 'https://example.com' }] },
    { id: 'ad3', project: 'Lumen Pay', sym: 'LMNP', per: 60, pool: 500000, chain: 'Solana', days: 18, people: 4120, checks: { audit: 1, kyc: 1, socials: 1, noApprovals: 1, tokenomics: 1 }, tasks: [{ id: 'b', type: 'balance', min: 20, text: 'Hold at least 20 USDT in your ProTrader balance' }, { id: 's', type: 'social', text: 'Read the Lumen Pay token overview', url: 'https://example.com' }] },
    { id: 'ad4', project: 'Tidal Swap', sym: 'TIDE', per: 400, pool: 3000000, chain: 'Ethereum', days: 2, people: 27650, checks: { audit: 0, kyc: 1, socials: 1, noApprovals: 1, tokenomics: 1 }, tasks: [{ id: 'w', type: 'wallet', text: 'Connect a wallet' }, { id: 's', type: 'social', text: 'Follow the official Tidal Swap account', url: 'https://example.com' }] },
  ];
  const score = (c) => Object.values(c.checks).filter(Boolean).length;

  PT.views.airdrops = {
    mount(root) {
      let filter = 'all';
      root.innerHTML = `<div class="page">
        <div class="pagehead"><div><h1>Airdrops</h1><p class="muted lead">Every campaign is scored against five safety checks before it is listed. Only 5 of 5 earns the Verified badge.</p></div>
        <button class="btn primary" id="a-new">${PT.icon('plus', 16)} Launch an airdrop</button></div>
        <div class="note">${PT.icon('shield', 16)}<span>A real airdrop never asks for your seed phrase, a payment to claim, or unlimited token approvals. If a task asks for any of these, stop and report it.</span></div>
        <div class="seg" id="a-f"><button data-f="all">All</button><button data-f="verified">Verified</button><button data-f="ending">Ending soon</button><button data-f="mine">Your submissions</button></div>
        <div class="cards" id="a-grid"></div></div>`;
      const grid = u.$('#a-grid', root);

      function taskState(c, tk) {
        const cl = PT.store.s.claims[c.id] || { done: {} };
        if (tk.type === 'wallet') return PT.wallet.connected();
        if (tk.type === 'balance') return PT.store.bal('USDT') >= tk.min;
        return !!cl.done[tk.id];
      }
      function draw() {
        u.$$('#a-f button', root).forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
        if (filter === 'mine') {
          const sub = PT.store.s.submissions;
          grid.innerHTML = sub.length ? sub.map((s) => `<div class="card stack"><div class="row between"><b>${u.esc(s.project)} (${u.esc(s.sym)})</b><span class="badge warn">In review</span></div>
            <div class="small muted">${s.pool.toLocaleString()} ${u.esc(s.sym)} · ${s.days} days · ${u.esc(s.plan)} plan · submitted ${u.timeAgo(s.t)}</div>
            <div class="small muted">Reviews take 24 to 48 hours. We contact you if documents are missing.</div></div>`).join('') : '<p class="muted pad">You have not submitted an airdrop yet.</p>';
          return;
        }
        let list = CAMPAIGNS.slice();
        if (filter === 'verified') list = list.filter((c) => score(c) === 5);
        if (filter === 'ending') list = list.filter((c) => c.days <= 5);
        grid.innerHTML = list.map((c) => {
          const cl = PT.store.s.claims[c.id] || { done: {} }, sc = score(c), done = c.tasks.every((t) => taskState(c, t));
          return `<div class="card stack" data-c="${c.id}">
            <div class="row between"><div><b>${u.esc(c.project)}</b><div class="muted small">${c.sym} · ${c.chain} · ends in ${c.days}d</div></div>
            ${sc === 5 ? '<span class="badge ok">Verified 5/5</span>' : `<span class="badge warn">${sc}/5 checks</span>`}</div>
            <div class="row between"><div><small class="muted">Your reward</small><div><b>${c.per} ${c.sym}</b></div></div><div class="right"><small class="muted">Pool</small><div><b>${u.compact(c.pool)} ${c.sym}</b></div></div></div>
            <ul class="tasks">${c.tasks.map((t) => {
              const ok = taskState(c, t);
              return `<li class="${ok ? 'ok' : ''}"><span class="tick">${ok ? PT.icon('check', 14) : ''}</span><span class="grow">${u.esc(t.text)}</span>
                ${t.type === 'social' && !ok ? `<a class="btn ghost sm" href="${t.url}" target="_blank" rel="noopener noreferrer" data-open="${c.id}:${t.id}">Open ${PT.icon('external', 13)}</a>` : ''}</li>`;
            }).join('')}</ul>
            <details class="small"><summary>Safety checks (${sc}/5)</summary><ul class="checks">${CHECKS.map(([k, l]) => `<li class="${c.checks[k] ? 'ok' : 'no'}">${c.checks[k] ? PT.icon('check', 14) : PT.icon('alert', 14)}<span>${l}</span></li>`).join('')}</ul>
            ${sc < 5 ? '<p class="muted">This campaign is missing a check. Participate only with funds you can afford to lose.</p>' : ''}</details>
            ${cl.claimed ? '<button class="btn block" disabled>Claimed</button>' : `<button class="btn block ${done ? 'primary' : ''}" data-claim="${c.id}" ${done ? '' : 'disabled'}>Claim ${c.per} ${c.sym}</button>`}
            <div class="small muted">${c.people.toLocaleString()} participants</div></div>`;
        }).join('') || '<p class="muted pad">No campaigns match this filter.</p>';
      }
      u.$('#a-f', root).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } };
      grid.onclick = (e) => {
        const op = e.target.closest('[data-open]');
        if (op) { const [cid, tid] = op.dataset.open.split(':'); const S = PT.store.s; S.claims[cid] = S.claims[cid] || { done: {} }; setTimeout(() => { S.claims[cid].done[tid] = true; PT.store.commit(); }, 1500); return; }
        const cb = e.target.closest('[data-claim]'); if (!cb) return;
        const c = CAMPAIGNS.find((x) => x.id === cb.dataset.claim), S = PT.store.s;
        const go = () => {
          S.claims[c.id] = Object.assign(S.claims[c.id] || { done: {} }, { claimed: true });
          PT.store.credit(c.sym, c.per); PT.store.log('airdrop', `Claimed ${c.per} ${c.sym} from ${c.project}`);
          PT.store.commit(); PT.ui.toast(`${c.per} ${c.sym} added to your wallet.`, 'ok');
        };
        if (score(c) < 5) { const m = PT.ui.modal({ title: 'Unverified campaign', size: 'sm', html: `<p>${u.esc(c.project)} passed ${score(c)} of 5 safety checks. Continue only if you understand the risk.</p><div class="row end"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Claim anyway</button></div>` }); m.body.onclick = (ev) => { if (ev.target.hasAttribute('data-ok')) { go(); } if (ev.target.hasAttribute('data-ok') || ev.target.hasAttribute('data-x')) m.close(); }; }
        else go();
      };
      u.$('#a-new', root).onclick = openSubmit;
      const off = PT.bus.on('state', draw), off2 = PT.bus.on('wallet', draw);
      draw();
      return () => { off(); off2(); };
    },
  };

  function openSubmit() {
    const plans = { Standard: 150, Featured: 400 };
    const m = PT.ui.modal({
      title: 'Launch an airdrop', size: 'md',
      html: `<div class="stack"><p class="muted">Reach ProTrader users with a vetted campaign. Every submission is manually reviewed. Only campaigns that pass all five safety checks receive the Verified badge.</p>
        <div class="row"><label class="field grow"><span>Project name</span><input class="input" id="s-name" maxlength="40"></label><label class="field grow"><span>Token ticker</span><input class="input" id="s-sym" maxlength="8"></label></div>
        <div class="row"><label class="field grow"><span>Website</span><input class="input" id="s-web" placeholder="https://"></label><label class="field grow"><span>Chain</span><select class="input" id="s-chain"><option>Solana</option><option>Ethereum</option></select></label></div>
        <label class="field"><span>Token contract address</span><input class="input" id="s-ca" spellcheck="false"></label>
        <label class="field"><span>Audit report link</span><input class="input" id="s-audit" placeholder="https://"></label>
        <div class="row"><label class="field grow"><span>Airdrop pool (tokens)</span><input class="input" id="s-pool" inputmode="numeric" value="1000000"></label><label class="field grow"><span>Duration</span><select class="input" id="s-days"><option>7</option><option>14</option><option>30</option></select></label></div>
        <div class="field"><span>Promotion plan</span><div class="seg full" id="s-plan">${Object.entries(plans).map(([k, v], i) => `<button type="button" data-p="${k}" class="${i ? '' : 'on'}">${k} · ${u.usd(v, 0)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="s-ok"><span>I confirm the claim flow never requests seed phrases, payments or unlimited approvals, and the team can complete KYC.</span></label>
        <button class="btn primary block" id="s-go">Pay and submit for review</button></div>`,
    });
    const g = (id) => u.$(id, m.body); let plan = 'Standard';
    g('#s-plan').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { plan = b.dataset.p; u.$$('#s-plan button', m.body).forEach((x) => x.classList.toggle('on', x === b)); } };
    g('#s-go').onclick = () => {
      const name = g('#s-name').value.trim(), sym = g('#s-sym').value.trim().toUpperCase(), web = g('#s-web').value.trim(), ca = g('#s-ca').value.trim(), au = g('#s-audit').value.trim(), pool = parseInt(g('#s-pool').value, 10);
      if (!name || !/^[A-Z0-9]{2,8}$/.test(sym)) return PT.ui.toast('Enter a project name and ticker.', 'err');
      if (!/^https:\/\//.test(web) || !/^https:\/\//.test(au)) return PT.ui.toast('Website and audit links must start with https://', 'err');
      const chain = g('#s-chain').value;
      if (!(chain === 'Ethereum' ? /^0x[a-fA-F0-9]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/).test(ca)) return PT.ui.toast('That contract address is not valid for ' + chain + '.', 'err');
      if (!(pool > 0)) return PT.ui.toast('Enter the airdrop pool size.', 'err');
      if (!g('#s-ok').checked) return PT.ui.toast('Confirm the safety statement to continue.', 'err');
      if (!PT.store.debit('USDT', plans[plan])) return PT.ui.toast('Not enough USDT for the promotion fee.', 'err');
      PT.store.s.submissions.unshift({ id: u.uid('sub'), project: name, sym, pool, days: +g('#s-days').value, plan, t: Date.now() });
      PT.store.log('airdrop', `Submitted ${name} airdrop (${plan} plan, ${u.usd(plans[plan], 0)})`);
      PT.store.commit(); m.close(); PT.ui.toast('Submitted. We will review within 48 hours.', 'ok');
    };
  }
})();
