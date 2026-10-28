/* Wallet connection (Ethereum + Solana), deposits (crypto / P2P / card) and withdrawals. */
(function () {
  const PT = window.PT, u = PT.u, cfg = PT.config;
  const CHAINS = { '0x1': 'Ethereum', '0x89': 'Polygon', '0xa': 'Optimism', '0xa4b1': 'Arbitrum', '0x38': 'BNB Chain', '0x2105': 'Base', '0xaa36a7': 'Sepolia testnet' };
  const RE = { eth: /^0x[a-fA-F0-9]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };

  const W = (PT.wallet = {
    type: null, address: null, chain: null, balance: null,
    connected() { return !!W.address; },

    emit() { PT.bus.emit('wallet'); },

    async connectEth() {
      const eth = window.ethereum;
      if (!eth) { PT.ui.toast('No Ethereum wallet found. Install MetaMask or open this page in your wallet browser.', 'err'); return false; }
      try {
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        W.type = 'ethereum'; W.address = accounts[0];
        W.chain = CHAINS[await eth.request({ method: 'eth_chainId' })] || 'Unknown network';
        W.refreshBalance();
        if (eth.on && !W._ethBound) {
          W._ethBound = true;
          eth.on('accountsChanged', (a) => { if (W.type !== 'ethereum') return; if (!a.length) W.disconnect(); else { W.address = a[0]; W.refreshBalance(); W.emit(); } });
          eth.on('chainChanged', (id) => { W.chain = CHAINS[id] || 'Unknown network'; W.refreshBalance(); W.emit(); });
        }
        W.emit(); return true;
      } catch (e) { PT.ui.toast(e && e.code === 4001 ? 'Connection request was rejected.' : 'Could not connect wallet.', 'err'); return false; }
    },

    async connectSol() {
      const p = (window.phantom && window.phantom.solana) || window.solana;
      if (!p || !p.isPhantom) { PT.ui.toast('Phantom not found. Install Phantom or use a Solana wallet browser.', 'err'); return false; }
      try {
        const r = await p.connect();
        W.type = 'solana'; W.address = r.publicKey.toString(); W.chain = 'Solana'; W.balance = null;
        if (!W._solBound && p.on) { W._solBound = true; p.on('disconnect', () => { if (W.type === 'solana') W.disconnect(); }); }
        W.emit(); return true;
      } catch (e) { PT.ui.toast('Connection request was rejected.', 'err'); return false; }
    },

    /* WalletConnect v2: add @walletconnect/ethereum-provider (or Reown AppKit) and set
       PT.config.walletConnectProjectId. See README > "Wallet connection". */
    connectWalletConnect() {
      if (!cfg.walletConnectProjectId) { PT.ui.toast('WalletConnect needs a project id. Add it in js/config.js (see README).', 'info'); return false; }
      PT.ui.toast('WalletConnect provider not bundled yet. See README for the 10-line integration.', 'info');
      return false;
    },

    async refreshBalance() {
      if (W.type !== 'ethereum' || !window.ethereum) return;
      try { const hex = await window.ethereum.request({ method: 'eth_getBalance', params: [W.address, 'latest'] }); W.balance = parseInt(hex, 16) / 1e18; W.emit(); } catch { /* ignore */ }
    },

    async disconnect() {
      try { if (W.type === 'solana') { const p = (window.phantom && window.phantom.solana) || window.solana; if (p && p.disconnect) await p.disconnect(); } } catch { /* ignore */ }
      W.type = W.address = W.chain = W.balance = null; W.emit();
    },

    openConnect() {
      const m = PT.ui.modal({
        title: 'Connect wallet', size: 'sm',
        html: `<div class="stack">
          <button class="walletopt" data-w="eth"><span class="wlogo eth">Ξ</span><span><b>Ethereum</b><small>MetaMask, Rabby, Coinbase Wallet</small></span></button>
          <button class="walletopt" data-w="sol"><span class="wlogo sol">◎</span><span><b>Solana</b><small>Phantom, Solflare</small></span></button>
          <button class="walletopt" data-w="wc"><span class="wlogo wc">WC</span><span><b>WalletConnect</b><small>Scan with a mobile wallet</small></span></button>
        </div>
        <p class="note">${PT.icon('shield', 16)}<span>Connecting only shares your public address. We never ask for your seed phrase or private key, and every transaction needs your approval in your wallet.</span></p>`,
      });
      m.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-w]'); if (!b) return;
        const ok = b.dataset.w === 'eth' ? await W.connectEth() : b.dataset.w === 'sol' ? await W.connectSol() : W.connectWalletConnect();
        if (ok) { m.close(); PT.ui.toast('Wallet connected: ' + u.short(W.address), 'ok'); }
      });
    },

    /* ---------- Deposit ---------- */
    openDeposit(tab = 'crypto') {
      const m = PT.ui.modal({
        title: 'Deposit USDT', size: 'md',
        html: `<div class="seg full" role="tablist">
          <button role="tab" data-t="crypto">Crypto</button><button role="tab" data-t="p2p">P2P</button><button role="tab" data-t="card">Debit / credit card</button></div>
          <div id="dep-body"></div>`,
      });
      const body = u.$('#dep-body', m.body);
      const tabs = u.$$('[data-t]', m.body);
      const show = (t) => { tabs.forEach((b) => b.classList.toggle('on', b.dataset.t === t)); ({ crypto: depCrypto, p2p: depP2P, card: depCard })[t](body, m); };
      tabs.forEach((b) => (b.onclick = () => show(b.dataset.t)));
      show(tab);
    },

    openWithdraw() {
      const m = PT.ui.modal({
        title: 'Withdraw USDT', size: 'sm',
        html: `<div class="stack">
          <label class="field"><span>Network</span><select class="input" id="w-net"><option value="eth">Ethereum (ERC-20)</option><option value="sol">Solana (SPL)</option></select></label>
          <label class="field"><span>Destination address</span><input class="input" id="w-addr" placeholder="Paste address" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Amount (USDT) <em class="muted">Available ${u.usd(PT.store.bal('USDT'))}</em></span><input class="input" id="w-amt" inputmode="decimal" placeholder="0.00"></label>
          <p class="note">${PT.icon('alert', 16)}<span>Double-check the network. Withdrawals sent to the wrong network can't be recovered. Network fee: 1 USDT.</span></p>
          <button class="btn primary block" id="w-go">Withdraw</button></div>`,
      });
      const g = (id) => u.$(id, m.body);
      if (W.address && g('#w-addr')) { g('#w-net').value = W.type === 'solana' ? 'sol' : 'eth'; g('#w-addr').value = W.address; }
      g('#w-go').onclick = () => {
        const net = g('#w-net').value, addr = g('#w-addr').value.trim(), amt = parseFloat(g('#w-amt').value);
        if (!RE[net].test(addr)) return PT.ui.toast('That address is not valid for the selected network.', 'err');
        if (!(amt > 1)) return PT.ui.toast('Minimum withdrawal is 2 USDT.', 'err');
        if (!PT.store.debit('USDT', amt)) return PT.ui.toast('Not enough USDT.', 'err');
        PT.store.log('withdraw', `Withdrew ${u.usd(amt - 1)} USDT to ${u.short(addr)} (${net === 'eth' ? 'Ethereum' : 'Solana'})`);
        PT.store.commit(); m.close(); PT.ui.toast('Withdrawal submitted (demo).', 'ok');
      };
    },

    /* Demo helper: credit USDT. In production only your backend credits after confirmations. */
    creditDemo(amount, text) {
      PT.store.credit('USDT', amount);
      PT.store.log('deposit', text);
      PT.store.commit();
    },
  });

  /* ---------- Deposit: crypto ---------- */
  function depCrypto(root, modal) {
    const nets = {
      eth: { name: 'Ethereum (ERC-20)', addr: cfg.depositAddresses.ethereum, conf: '12 confirmations (~3 min)' },
      sol: { name: 'Solana (SPL)', addr: cfg.depositAddresses.solana, conf: '1 finalized confirmation (~15 sec)' },
    };
    root.innerHTML = `<div class="stack">
      <label class="field"><span>Network</span><select class="input" id="d-net">${Object.entries(nets).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
      <div class="addrbox"><div><small class="muted">Your USDT deposit address</small><code id="d-addr"></code></div><button class="btn ghost sm" id="d-copy">${PT.icon('copy', 15)} Copy</button></div>
      <ul class="plain small muted" id="d-info"></ul>
      <div id="d-send"></div>
      ${cfg.demoMode ? `<div class="demo"><b>Demo mode.</b> Real deposit addresses are issued by your backend. Simulate a confirmed deposit:
        <div class="row"><input class="input" id="d-amt" inputmode="decimal" value="1000"><button class="btn primary" id="d-sim">Simulate deposit</button></div></div>` : ''}
    </div>`;
    const g = (id) => u.$(id, root), net = () => nets[g('#d-net').value];
    function paint() {
      const n = net(), k = g('#d-net').value;
      g('#d-addr').textContent = n.addr || 'Assigned by your backend in production';
      g('#d-copy').disabled = !n.addr;
      g('#d-info').innerHTML = `<li>Send only USDT on ${n.name}. Other assets or networks may be lost.</li><li>Credited after ${n.conf}.</li><li>Minimum deposit: 10 USDT.</li>`;
      const canSend = k === 'eth' && W.type === 'ethereum' && RE.eth.test(n.addr);
      g('#d-send').innerHTML = k === 'eth' && W.type === 'ethereum'
        ? `<button class="btn ghost block" id="d-wsend" ${canSend ? '' : 'disabled'}>Send from connected wallet (${u.short(W.address)})</button>${canSend ? '' : '<small class="muted">Enable once a deposit address is configured.</small>'}`
        : (W.connected() ? '' : `<button class="btn ghost block" id="d-connect">Connect wallet to send directly</button>`);
      const c = g('#d-connect'); if (c) c.onclick = () => { modal.close(); W.openConnect(); };
      const s = g('#d-wsend'); if (s && canSend) s.onclick = sendEthUsdt;
    }
    async function sendEthUsdt() {
      const amt = parseFloat((g('#d-amt') || {}).value) || 0;
      if (!(amt >= 10)) return PT.ui.toast('Enter at least 10 USDT.', 'err');
      const to = net().addr.toLowerCase().replace('0x', '').padStart(64, '0');
      const val = BigInt(Math.round(amt * 1e6)).toString(16).padStart(64, '0');
      try {
        await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: W.address, to: cfg.usdtContracts.ethereum, data: '0xa9059cbb' + to + val }] });
        PT.ui.toast('Transaction sent. Your balance updates after confirmations.', 'ok');
      } catch { PT.ui.toast('Transaction cancelled.', 'err'); }
    }
    g('#d-net').onchange = paint;
    g('#d-copy').onclick = () => net().addr && u.copy(net().addr);
    const sim = g('#d-sim');
    if (sim) sim.onclick = () => {
      const a = parseFloat(g('#d-amt').value);
      if (!(a >= 10)) return PT.ui.toast('Minimum deposit is 10 USDT.', 'err');
      W.creditDemo(a, `Deposited ${u.usd(a)} USDT via ${net().name}`);
      PT.ui.toast(`${u.usd(a)} USDT credited (demo).`, 'ok'); modal.close();
    };
    paint();
  }

  /* ---------- Deposit: P2P ---------- */
  const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, KES: 129, GHS: 15.5, INR: 84 };
  const MERCHANTS = [
    ['SwiftCash', 5.0, 8120, 99.6, 1.002, ['Bank transfer', 'Wise']],
    ['NairaDesk', 4.9, 5480, 98.9, 0.998, ['Bank transfer', 'Mobile money']],
    ['EuroBridge', 4.9, 3210, 99.1, 1.006, ['SEPA', 'PayPal']],
    ['QuickUSD', 4.8, 1980, 97.8, 0.995, ['Bank transfer', 'Cash app']],
  ];
  function depP2P(root, modal) {
    root.innerHTML = `<div class="stack">
      <div class="row between"><label class="field grow"><span>I pay with</span><select class="input" id="p-cur">${Object.keys(RATES).map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div id="p-list" class="stack"></div>
      <p class="note">${PT.icon('shield', 16)}<span>Merchant USDT is held in escrow while you pay. It is released to you only after the merchant confirms your payment. Rates are indicative.</span></p></div>`;
    const cur = () => u.$('#p-cur', root).value;
    function list() {
      const c = cur();
      u.$('#p-list', root).innerHTML = MERCHANTS.map((m, i) => {
        const rate = RATES[c] * m[4];
        return `<div class="merchant"><div class="grow"><b>${m[0]}</b> <span class="muted small">${m[1].toFixed(1)} rating · ${u.compact(m[2])} orders · ${m[3]}% completion</span>
        <div class="small muted">${m[5].join(', ')} · Limit 20 to 2,000 USDT</div></div>
        <div class="right"><b>${rate >= 100 ? rate.toFixed(0) : rate.toFixed(3)} ${c}</b><small class="muted">per USDT</small></div>
        <button class="btn primary sm" data-i="${i}">Buy</button></div>`;
      }).join('');
    }
    u.$('#p-cur', root).onchange = list; list();
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) order(+b.dataset.i); });

    function order(i) {
      const m = MERCHANTS[i], c = cur(), rate = RATES[c] * m[4];
      root.innerHTML = `<div class="stack">
        <button class="btn ghost sm fit" id="p-back">Back to merchants</button>
        <div class="card inset"><b>${m[0]}</b><div class="muted small">${rate >= 100 ? rate.toFixed(0) : rate.toFixed(3)} ${c} per USDT · ${m[5].join(', ')}</div></div>
        <label class="field"><span>You pay (${c})</span><input class="input" id="p-pay" inputmode="decimal" value="${Math.round(100 * rate)}"></label>
        <div class="row between"><span class="muted">You receive</span><b id="p-get"></b></div>
        <button class="btn primary block" id="p-go">Create order</button><div id="p-step"></div></div>`;
      const pay = u.$('#p-pay', root), get = () => (parseFloat(pay.value) || 0) / rate;
      const upd = () => (u.$('#p-get', root).textContent = get().toFixed(2) + ' USDT'); pay.oninput = upd; upd();
      u.$('#p-back', root).onclick = () => depP2P(root, modal);
      u.$('#p-go', root).onclick = () => {
        const usdt = get();
        if (usdt < 20 || usdt > 2000) return PT.ui.toast('Order must be between 20 and 2,000 USDT.', 'err');
        u.$('#p-go', root).remove();
        const step = u.$('#p-step', root);
        let left = 900;
        step.innerHTML = `<div class="card inset stack"><b>Step 1: Pay the merchant</b>
          <div class="small muted">Send ${u.esc(pay.value)} ${c} using ${m[5][0]}. Payment details are shown by the merchant in production. Pay within <b id="p-timer">15:00</b>.</div>
          <button class="btn primary block" id="p-paid">I have paid</button></div>`;
        const tm = setInterval(() => { left--; const el = u.$('#p-timer', root); if (!el) return clearInterval(tm); el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); }, 1000);
        u.$('#p-paid', root).onclick = () => {
          clearInterval(tm);
          step.innerHTML = `<div class="card inset"><b>Step 2: Waiting for ${m[0]} to release USDT</b><div class="small muted">Escrow is locked. This takes a few seconds in the demo.</div></div>`;
          setTimeout(() => {
            W.creditDemo(usdt, `P2P purchase of ${usdt.toFixed(2)} USDT from ${m[0]} (${pay.value} ${c})`);
            PT.ui.toast(`${usdt.toFixed(2)} USDT released to your balance (demo).`, 'ok'); modal.close();
          }, 3500);
        };
      };
    }
  }

  /* ---------- Deposit: card ---------- */
  function depCard(root, modal) {
    root.innerHTML = `<div class="stack">
      <div class="row"><label class="field grow"><span>You pay</span><input class="input" id="c-amt" inputmode="decimal" value="100"></label>
      <label class="field"><span>Currency</span><select class="input" id="c-cur">${['USD', 'EUR', 'GBP'].map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div class="card inset stack small"><div class="row between"><span class="muted">Provider fee (${(cfg.fees.cardProvider * 100).toFixed(1)}%)</span><b id="c-fee"></b></div>
      <div class="row between"><span class="muted">You receive</span><b id="c-get"></b></div></div>
      <button class="btn primary block" id="c-go">Continue to secure payment</button>
      <p class="note">${PT.icon('shield', 16)}<span>Card details are entered on your payment partner's page (for example MoonPay, Transak or Banxa). ProTrader never sees or stores card numbers.</span></p></div>`;
    const g = (id) => u.$(id, root);
    const calc = () => { const a = parseFloat(g('#c-amt').value) || 0, c = g('#c-cur').value, fee = a * cfg.fees.cardProvider; g('#c-fee').textContent = fee.toFixed(2) + ' ' + c; g('#c-get').textContent = ((a - fee) / RATES[c]).toFixed(2) + ' USDT'; return { a, c, usdt: (a - fee) / RATES[c] }; };
    g('#c-amt').oninput = calc; g('#c-cur').onchange = calc; calc();
    g('#c-go').onclick = () => {
      const { a, c, usdt } = calc();
      if (a < 20) return PT.ui.toast('Minimum card purchase is 20.', 'err');
      g('#c-go').disabled = true; g('#c-go').textContent = 'Opening payment partner…';
      setTimeout(() => { W.creditDemo(usdt, `Card purchase ${a} ${c} → ${usdt.toFixed(2)} USDT`); PT.ui.toast(`${usdt.toFixed(2)} USDT credited (demo).`, 'ok'); modal.close(); }, 2000);
    };
  }
})();
