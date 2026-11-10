/* ProTrader wallet: connection (Ethereum, Solana, WalletConnect), deposits (crypto / P2P / bank / PayPal / card) and withdrawals.
 *
 * Production notes:
 *  - Real balances must only be changed by your backend. Set PT.config.demoMode = false.
 *  - depositVerify verifies native Sepolia test ETH only; it does not credit USDT.
 *    Mainnet ERC-20 USDT needs a separate backend verifier before it can be credited.
 *  - Production payment endpoints (POST, JSON, cookie auth): withdraw, bankDeposit,
 *    paypalCheckout and cardCheckout. The backend must validate amounts and own the ledger.
 *  - PT.config.limits / PT.config.fees / PT.config.bankAccounts are optional overrides (see defaults below).
 *  - WalletConnect needs PT.config.walletConnectProjectId (free from cloud.reown.com).
 */
(function () {
  const PT = window.PT, u = PT.u, cfg = PT.config;
  const DEMO = !!cfg.demoMode;

  const CHAINS = { '0x1': 'Ethereum', '0x89': 'Polygon', '0xa': 'Optimism', '0xa4b1': 'Arbitrum', '0x38': 'BNB Chain', '0x2105': 'Base', '0xaa36a7': 'Sepolia testnet' };
  const RE = { eth: /^0x[a-fA-F0-9]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };
  const LIM = Object.assign({ cryptoMin: 10, p2pMin: 3, p2pMax: 2000, bankMin: 20, paypalMin: 10, cardMin: 20, withdrawMin: 2, withdrawFee: 1 }, cfg.limits || {});
  const FEES = Object.assign({ cardProvider: 0.035, paypal: 0.029 }, cfg.fees || {});
  const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, KES: 129, GHS: 15.5, INR: 84 }; // indicative: units of currency per 1 USD

  /* ---------- helpers ---------- */
  const normChain = (id) => (typeof id === 'number' ? '0x' + id.toString(16) : String(id || '').toLowerCase());

  // Decimal string -> BigInt base units without floating point (e.g. "12.5", 6 -> 12500000n).
  function toUnits(v, dec) {
    if (!Number.isInteger(dec) || dec < 0 || dec > 255) return null;
    const s = String(v ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const parts = s.split('.');
    const fraction = parts[1] || '';
    if (fraction.length > dec) return null;
    try { return BigInt(parts[0] + fraction.padEnd(dec, '0')); }
    catch { return null; }
  }

  function parseAmount(value, decimals = 6) {
    const s = String(value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const units = toUnits(s, decimals);
    if (units === null) return null;
    const amount = Number(units) / (10 ** decimals);
    return Number.isFinite(amount) ? amount : null;
  }

  function refCode() {
    const b = new Uint8Array(5); crypto.getRandomValues(b);
    return 'PT-' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 8);
  }

  // POST to a backend endpoint if configured. Returns { ok, none, data }.
  async function api(name, body) {
    const url = cfg.endpoints && cfg.endpoints[name];
    if (!url) return { ok: false, none: true };
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      return { ok: r.ok, data: await r.json().catch(() => ({})) };
    } catch { return { ok: false }; }
  }

  /* EIP-6963 wallet discovery (avoids clashes when several wallet extensions are installed). */
  const evm = new Map();
  window.addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; if (d && d.info && d.provider) evm.set(d.info.uuid, d); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  function evmWallets() {
    const list = [...evm.values()];
    if (!list.length && window.ethereum) list.push({ info: { uuid: 'injected', name: 'Browser wallet' }, provider: window.ethereum });
    return list;
  }
  function solWallets() {
    const out = [], ph = (window.phantom && window.phantom.solana) || window.solana;
    if (ph && ph.isPhantom) out.push({ name: 'Phantom', p: ph });
    if (window.solflare && window.solflare.isSolflare) out.push({ name: 'Solflare', p: window.solflare });
    return out;
  }

  const bound = new WeakSet();

  const W = (PT.wallet = {
    type: null, address: null, chain: null, chainId: null, balance: null, provider: null, viaKit: false,
    connected() { return !!W.address; },
    emit() { PT.bus.emit('wallet'); },

    async connectEth(entry) {
      entry = entry || evmWallets()[0];
      if (!entry) { PT.ui.toast('No Ethereum wallet found. Install MetaMask or use WalletConnect.', 'err'); return false; }
      const prov = entry.provider;
      try {
        const accounts = await prov.request({ method: 'eth_requestAccounts' });
        if (!accounts || !accounts.length) throw new Error('no accounts');
        W.viaKit = false; W.type = 'ethereum'; W.provider = prov; W.address = accounts[0];
        W.chainId = normChain(await prov.request({ method: 'eth_chainId' }));
        W.chain = CHAINS[W.chainId] || 'Unknown network';
        W.balance = null;
        W.refreshBalance();
        if (prov.on && !bound.has(prov)) {
          bound.add(prov);
          prov.on('accountsChanged', (a) => {
            if (W.provider !== prov) return;
            if (!a.length) W.disconnect(); else { W.address = a[0]; W.refreshBalance(); W.emit(); }
          });
          prov.on('chainChanged', (id) => {
            if (W.provider !== prov) return;
            W.chainId = normChain(id); W.chain = CHAINS[W.chainId] || 'Unknown network'; W.refreshBalance(); W.emit();
          });
          prov.on('disconnect', () => { if (W.provider === prov) W.disconnect(); });
        }
        W.emit(); return true;
      } catch (e) {
        PT.ui.toast(e && e.code === 4001 ? 'Connection request was rejected.' : 'Could not connect wallet.', 'err');
        return false;
      }
    },

    async connectSol(entry) {
      entry = entry || solWallets()[0];
      if (!entry) { PT.ui.toast('No Solana wallet found. Install Phantom or Solflare.', 'err'); return false; }
      const p = entry.p;
      try {
        const r = await p.connect();
        const pk = (r && r.publicKey) || p.publicKey;
        if (!pk) throw new Error('no key');
        W.viaKit = false; W.type = 'solana'; W.provider = p; W.address = pk.toString(); W.chain = 'Solana'; W.chainId = null; W.balance = null;
        if (p.on && !bound.has(p)) {
          bound.add(p);
          p.on('disconnect', () => { if (W.provider === p) W.disconnect(); });
          p.on('accountChanged', (k) => { if (W.provider !== p) return; if (k) { W.address = k.toString(); W.emit(); } else W.disconnect(); });
        }
        W.emit(); return true;
      } catch (e) {
        PT.ui.toast('Connection request was rejected.', 'err');
        return false;
      }
    },

    /* WalletConnect via Reown AppKit: supports EVM and Solana through the configured bundle. */
    async connectWalletConnect() {
      if (!cfg.walletConnectProjectId) { PT.ui.toast('WalletConnect needs a project id. Set PT.config.walletConnectProjectId.', 'info'); return false; }
      try {
        if (!W._kit) {
          W._kitMod = await import(cfg.appkitBundle || '/js/appkit.bundle.js');
          W._kit = W._kitMod.initAppKit({
            projectId: cfg.walletConnectProjectId,
            adopt: (info) => W._adopt(info),
            release: (type) => W._release(type),
          });
        }
        await W._kitMod.open();
        return true;
      } catch (e) {
        console.error('AppKit load failed', e);
        PT.ui.toast('WalletConnect could not load. Check that js/appkit.bundle.js exists and the project ID is configured.', 'err');
        return false;
      }
    },

    _adopt(info) {
      if (!info || !info.address || !['ethereum', 'solana'].includes(info.type)) return;
      const changed = W.address !== info.address || W.type !== info.type;
      W.viaKit = true;
      W.type = info.type;
      W.address = info.address;
      W.chain = info.chain || (info.type === 'solana' ? 'Solana' : 'Unknown network');
      W.chainId = info.chainId || null;
      W.provider = info.provider || null;
      if (changed) W.balance = null;
      W.refreshBalance();
      W.emit();
      if (changed) PT.ui.toast('Wallet connected: ' + u.short(W.address), 'ok');
    },

    _release(type) {
      if (!W.viaKit || (type && W.type !== type)) return;
      W.type = W.address = W.chain = W.chainId = W.balance = W.provider = null;
      W.viaKit = false;
      W.emit();
    },

    async refreshBalance() {
      if (W.type !== 'ethereum' || !W.provider) return;
      try {
        const hex = await W.provider.request({ method: 'eth_getBalance', params: [W.address, 'latest'] });
        W.balance = Number(BigInt(hex)) / 1e18; W.emit();
      } catch { /* ignore */ }
    },

    async disconnect() {
      const p = W.provider, viaKit = W.viaKit;
      W.type = W.address = W.chain = W.chainId = W.balance = W.provider = null;
      W.viaKit = false;
      try {
        if (viaKit && W._kitMod && typeof W._kitMod.disconnectAll === 'function') await W._kitMod.disconnectAll();
        else if (p && typeof p.disconnect === 'function') await p.disconnect();
      } catch { /* ignore provider disconnect errors */ }
      W.emit();
    },

    openConnect() {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      const evmList = evmWallets(), solList = solWallets();
      const opt = (key, cls, logo, name, sub) => `<button class="walletopt" data-w="${key}"><span class="wlogo ${cls}">${logo}</span><span><b>${u.esc(name)}</b><small>${u.esc(sub)}</small></span></button>`;
      const m = PT.ui.modal({
        title: 'Connect wallet', size: 'sm',
        html: `<div class="stack">
          ${evmList.map((w, i) => opt('eth:' + i, 'eth', 'Ξ', w.info.name, 'Ethereum and EVM chains')).join('')}
          ${solList.map((w, i) => opt('sol:' + i, 'sol', '◎', w.name, 'Solana')).join('')}
          ${!evmList.length && !solList.length ? '<p class="muted small">No browser wallet detected. Use WalletConnect to link a mobile wallet.</p>' : ''}
          ${opt('wc', 'wc', 'WC', 'WalletConnect', 'Scan with any mobile wallet')}
        </div>
        <p class="note">${PT.icon('shield', 16)}<span>Connecting only shares your public address. We never ask for your seed phrase or private key, and every transaction needs your approval in your wallet.</span></p>`,
      });
      m.body.onclick = async (e) => {
        const b = e.target.closest('[data-w]'); if (!b) return;
        const [kind, idx] = b.dataset.w.split(':');
        const ok = kind === 'eth' ? await W.connectEth(evmList[+idx]) : kind === 'sol' ? await W.connectSol(solList[+idx]) : await W.connectWalletConnect();
        if (ok) { m.close(); PT.ui.toast('Wallet connected: ' + u.short(W.address), 'ok'); }
      };
    },

    /* ---------- Deposit ---------- */
    openDeposit(tab = 'crypto') {
      const m = PT.ui.modal({
        title: 'Deposit USDT', size: 'md',
        html: `<div class="seg full" role="tablist">
          <button role="tab" data-t="crypto">Crypto</button><button role="tab" data-t="p2p">P2P</button><button role="tab" data-t="bank">Bank</button><button role="tab" data-t="paypal">PayPal</button><button role="tab" data-t="card">Card</button></div>
          <div id="dep-body"></div>`,
      });
      const body = u.$('#dep-body', m.body);
      const tabs = u.$$('[data-t]', m.body);
      const views = { crypto: depCrypto, p2p: depP2P, bank: depBank, paypal: depPayPal, card: depCard };
      const show = (t) => { tabs.forEach((b) => b.classList.toggle('on', b.dataset.t === t)); body.onclick = null; views[t](body, m); };
      tabs.forEach((b) => (b.onclick = () => show(b.dataset.t)));
      show(views[tab] ? tab : 'crypto');
    },

    openWithdraw() {
      const m = PT.ui.modal({
        title: 'Withdraw USDT', size: 'sm',
        html: `<div class="stack">
          <label class="field"><span>Network</span><select class="input" id="w-net"><option value="eth">Ethereum (ERC-20)</option><option value="sol">Solana (SPL)</option></select></label>
          <label class="field"><span>Destination address</span><input class="input" id="w-addr" placeholder="Paste address" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Amount (USDT) <em class="muted">Available ${u.usd(PT.store.bal('USDT'))}</em></span><input class="input" id="w-amt" inputmode="decimal" placeholder="0.00"></label>
          <p class="note">${PT.icon('alert', 16)}<span>Double-check the network. Withdrawals sent to the wrong network can't be recovered. Minimum ${LIM.withdrawMin} USDT. Network fee: ${LIM.withdrawFee} USDT.</span></p>
          <button class="btn primary block" id="w-go">Withdraw</button></div>`,
      });
      const g = (id) => u.$(id, m.body);
      if (W.address) { g('#w-net').value = W.type === 'solana' ? 'sol' : 'eth'; g('#w-addr').value = W.address; }
      g('#w-go').onclick = async () => {
        const net = g('#w-net').value, addr = g('#w-addr').value.trim();
        const amt = parseAmount(g('#w-amt').value, 6);
        if (!RE[net].test(addr)) return PT.ui.toast('That address is not valid for the selected network.', 'err');
        if (amt === null || !(amt >= LIM.withdrawMin)) return PT.ui.toast(`Enter a valid amount. Minimum withdrawal is ${LIM.withdrawMin} USDT.`, 'err');
        if (DEMO && amt > PT.store.bal('USDT')) return PT.ui.toast('Not enough USDT.', 'err');
        const btn = g('#w-go'); btn.disabled = true;
        const netName = net === 'eth' ? 'Ethereum' : 'Solana';
        const r = await api('withdraw', { network: net, address: addr, amount: amt });
        if (r.ok) {
          // The backend holds the real balance; refresh from it instead of debiting locally.
          PT.store.log('withdraw', `Withdrawal of ${u.usd(amt - LIM.withdrawFee)} USDT to ${u.short(addr)} (${netName}) requested`);
          if (PT.store.refresh) await PT.store.refresh(); else PT.store.commit();
          m.close(); PT.ui.toast('Withdrawal submitted.', 'ok');
        } else if (DEMO) {
          if (!PT.store.debit('USDT', amt)) { btn.disabled = false; return PT.ui.toast('Not enough USDT.', 'err'); }
          PT.store.log('withdraw', `Withdrew ${u.usd(amt - LIM.withdrawFee)} USDT to ${u.short(addr)} (${netName})`);
          PT.store.commit(); m.close(); PT.ui.toast('Withdrawal submitted (demo).', 'ok');
        } else {
          btn.disabled = false;
          PT.ui.toast(r.none ? 'Withdrawals are not enabled yet.' : 'Withdrawal could not be processed. Try again.', 'err');
        }
      };
    },

    /* Demo helper only. In production your backend credits balances after confirmations. */
    creditDemo(amount, text) {
      if (!DEMO) return false;
      PT.store.credit('USDT', amount);
      PT.store.log('deposit', text);
      PT.store.commit();
      return true;
    },
  });

  /* ---------- Deposit: crypto ---------- */

function depCrypto(root, modal) {
  const nets = {
    eth: {
      name: 'Ethereum (ERC-20 USDT)',
      addr: cfg.depositAddresses && cfg.depositAddresses.ethereum,
      conf: '12 confirmations'
    },
    sol: {
      name: 'Solana (SPL USDT)',
      addr: cfg.depositAddresses && cfg.depositAddresses.solana,
      conf: '1 finalized confirmation'
    },
    sepolia: {
      name: 'Sepolia test ETH',
      addr: cfg.depositAddresses && cfg.depositAddresses.sepoliaEth,
      conf: '3 confirmations'
    }
  };

  root.innerHTML = `
    <div class="stack">
      <label class="field">
        <span>Network</span>
        <select class="input" id="d-net">
          ${Object.entries(nets).map(([k, v]) =>
            `<option value="${k}">${u.esc(v.name)}</option>`
          ).join('')}
        </select>
      </label>

      <div class="addrbox">
        <div>
          <small class="muted" id="d-address-label">Deposit address</small>
          <code id="d-addr"></code>
        </div>
        <button class="btn ghost sm" id="d-copy">
          ${PT.icon('copy', 15)} Copy
        </button>
      </div>

      <ul class="plain small muted" id="d-info"></ul>

      <div id="d-send"></div>

      ${DEMO ? `
        <div class="demo">
          <b>Demo mode.</b>
          Simulate a USDT deposit to test the demo balance:
          <div class="row">
            <input class="input" id="d-amt"
              inputmode="decimal" value="1000">
            <button class="btn primary" id="d-sim">
              Simulate deposit
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const g = (id) => u.$(id, root);
  const net = () => nets[g('#d-net').value];

  function paint() {
    const k = g('#d-net').value;
    const n = net();
    const simPanel = root.querySelector('.demo');
    if (simPanel) simPanel.hidden = k === 'sepolia';

    g('#d-addr').textContent =
      n.addr || 'Deposit address not configured';

    g('#d-copy').disabled = !n.addr;

    if (k === 'sepolia') {
      g('#d-address-label').textContent =
        'Sepolia test ETH receiving address';

      g('#d-info').innerHTML = `
        <li>Send native Sepolia test ETH only.</li>
        <li>Network: Sepolia testnet (chain ID 11155111).</li>
        <li>Required confirmations: 3.</li>
        <li>This test deposit does not credit your USDT balance.</li>
      `;

      g('#d-send').innerHTML = `
        <div class="stack">
          <label class="field">
            <span>Amount of test ETH to send</span>
            <input class="input" id="d-sepolia-amount"
              inputmode="decimal" placeholder="0.001">
          </label>

          <button class="btn primary block" id="d-sepolia-send"
            ${n.addr && RE.eth.test(n.addr) ? '' : 'disabled'}>
            Send Sepolia test ETH
          </button>

          <div class="divider"></div>

          <label class="field">
            <span>Transaction hash</span>
            <input class="input" id="d-sepolia-hash"
              placeholder="0x...">
          </label>

          <button class="btn ghost block" id="d-sepolia-verify">
            Verify transaction
          </button>

          <p class="small muted" id="d-sepolia-status">
            Send a transaction or enter an existing transaction hash.
          </p>
        </div>
      `;

      g('#d-sepolia-send').onclick = sendSepoliaEth;
      g('#d-sepolia-verify').onclick = verifySepoliaEth;

      return;
    }

    g('#d-address-label').textContent = 'Your USDT deposit address';

    g('#d-info').innerHTML = `
      <li>Send only USDT on ${u.esc(n.name)}.</li>
      <li>Credited after ${n.conf}.</li>
      <li>Minimum deposit: ${LIM.cryptoMin} USDT.</li>
    `;

    const ethReady = k === 'eth' && W.type === 'ethereum';

    const canSend = ethReady &&
      RE.eth.test(n.addr || '') &&
      RE.eth.test(
        (cfg.usdtContracts && cfg.usdtContracts.ethereum) || ''
      );

    if (ethReady) {
      g('#d-send').innerHTML = `
        <label class="field">
          <span>Amount to send (USDT)</span>
          <input class="input" id="d-sendamt"
            inputmode="decimal"
            placeholder="${LIM.cryptoMin}"
            ${canSend ? '' : 'disabled'}>
        </label>

        <button class="btn ghost block" id="d-wsend"
          ${canSend ? '' : 'disabled'}>
          Send from connected wallet (${u.esc(u.short(W.address))})
        </button>
      `;
    } else {
      g('#d-send').innerHTML = W.connected()
        ? ''
        : `<button class="btn ghost block" id="d-connect">
             Connect wallet to send directly
           </button>`;
    }

    const c = g('#d-connect');
    if (c) {
      c.onclick = () => {
        modal.close();
        W.openConnect();
      };
    }

    const s = g('#d-wsend');
    if (s && canSend) s.onclick = sendEthUsdt;
  }

  async function sendSepoliaEth() {
    const prov = W.provider;

    if (!prov || W.type !== 'ethereum') {
      return PT.ui.toast(
        'Connect an Ethereum-compatible wallet first.',
        'err'
      );
    }

    const address = cfg.depositAddresses &&
      cfg.depositAddresses.sepoliaEth;

    if (!RE.eth.test(address || '')) {
      return PT.ui.toast(
        'Sepolia deposit address is not configured.',
        'err'
      );
    }

    const amount = toUnits(
      g('#d-sepolia-amount').value,
      18
    );

    if (!amount || amount <= 0n) {
      return PT.ui.toast(
        'Enter a valid ETH amount greater than zero.',
        'err'
      );
    }

    const button = g('#d-sepolia-send');
    button.disabled = true;
    button.textContent = 'Preparing transaction...';

    try {
      if (W.chainId !== '0xaa36a7') {
        await prov.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }]
        });
      }

      W.chainId = '0xaa36a7';
      W.chain = CHAINS['0xaa36a7'];

      const transactionHash = await prov.request({
        method: 'eth_sendTransaction',
        params: [{
          from: W.address,
          to: address,
          value: '0x' + amount.toString(16)
        }]
      });

      g('#d-sepolia-hash').value = transactionHash;

      PT.ui.toast(
        'Sepolia transaction submitted. Checking confirmations...',
        'ok'
      );

      await verifySepoliaEth();

    } catch (error) {
      console.error('Sepolia deposit failed:', error);

      PT.ui.toast(
        error && error.code === 4001
          ? 'Transaction cancelled.'
          : 'Could not send Sepolia ETH. Check your wallet and network.',
        'err'
      );
    } finally {
      button.disabled = false;
      button.textContent = 'Send Sepolia test ETH';
    }
  }

  async function verifySepoliaEth() {
    const hash = g('#d-sepolia-hash').value.trim();
    const status = g('#d-sepolia-status');
    const button = g('#d-sepolia-verify');

    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      status.textContent = 'Enter a valid transaction hash.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Checking...';
    status.textContent = 'Checking transaction on Sepolia...';

    try {
      const result = await api('depositVerify', {
        transactionHash: hash
      });

      const data = result.data || {};

      if (result.ok && data.status === 'verified') {
        status.textContent =
          `Verified! ${data.amountEth} Sepolia ETH received. ` +
          'This is verification only; no ProTrader balance has been credited.';

        PT.ui.toast(
          'Sepolia test deposit successfully verified.',
          'ok'
        );

      } else if (result.ok && data.status === 'confirming') {
        status.textContent =
          `Waiting for confirmations: ${data.confirmations || 0}` +
          ` / ${data.required || 3}. Check again shortly.`;

      } else {
        status.textContent =
          data.error || 'Verification failed. Please try again.';
      }

    } catch (error) {
      console.error('Sepolia verification error:', error);
      status.textContent =
        'Could not contact the verification server.';
    } finally {
      button.disabled = false;
      button.textContent = 'Verify transaction';
    }
  }

  async function sendEthUsdt() {
    const prov = W.provider;

    if (!prov || W.type !== 'ethereum') {
      return PT.ui.toast(
        'Connect an Ethereum wallet first.',
        'err'
      );
    }

    const units = toUnits(g('#d-sendamt').value, 6);

    if (!units || units < BigInt(LIM.cryptoMin) * 1000000n) {
      return PT.ui.toast(
        `Enter at least ${LIM.cryptoMin} USDT.`,
        'err'
      );
    }

    if (W.chainId !== '0x1') {
      try {
        await prov.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }]
        });

        W.chainId = '0x1';
        W.chain = CHAINS['0x1'];

      } catch {
        return PT.ui.toast(
          'Switch your wallet to Ethereum Mainnet to send USDT.',
          'err'
        );
      }
    }

    const to = net().addr.toLowerCase()
      .replace('0x', '').padStart(64, '0');

    const val = units.toString(16).padStart(64, '0');

    try {
      const transactionHash = await prov.request({
        method: 'eth_sendTransaction',
        params: [{
          from: W.address,
          to: cfg.usdtContracts.ethereum,
          value: '0x0',
          data: '0xa9059cbb' + to + val
        }]
      });

      PT.ui.toast(
        'USDT transaction sent (' + u.short(transactionHash) + '). The current backend verifies Sepolia native ETH only; this USDT transfer is not yet verified or credited.',
        'info'
      );

    } catch (error) {
      PT.ui.toast(
        error && error.code === 4001
          ? 'Transaction cancelled.'
          : 'Transaction failed.',
        'err'
      );
    }
  }

  g('#d-net').onchange = paint;

  g('#d-copy').onclick = () => {
    if (net().addr) u.copy(net().addr);
  };

  const sim = g('#d-sim');

  if (sim) {
    sim.onclick = () => {
      const a = parseFloat(g('#d-amt').value);

      if (!(a >= LIM.cryptoMin)) {
        return PT.ui.toast(
          `Minimum deposit is ${LIM.cryptoMin} USDT.`,
          'err'
        );
      }

      if (W.creditDemo(
        a,
        `Deposited ${u.usd(a)} USDT via ${net().name}`
      )) {
        PT.ui.toast(
          `${u.usd(a)} USDT credited (demo).`,
          'ok'
        );
        modal.close();
      }
    };
  }

  paint();
}

  /* ---------- Deposit: P2P ---------- */
  const MERCHANTS = [
    ['SwiftCash', 5.0, 8120, 99.6, 1.002, ['Bank transfer', 'Wise']],
    ['NairaDesk', 4.9, 5480, 98.9, 0.998, ['Bank transfer', 'Mobile money']],
    ['EuroBridge', 4.9, 3210, 99.1, 1.006, ['SEPA', 'PayPal']],
    ['QuickUSD', 4.8, 1980, 97.8, 0.995, ['Bank transfer', 'Cash app']],
  ];
  const fmtRate = (r) => (r >= 100 ? r.toFixed(0) : r.toFixed(3));

  function depP2P(root, modal) {
    if (!DEMO) {
      root.innerHTML = `<div class="card inset stack"><b>P2P deposits are not enabled.</b><p class="muted small">The listed merchants and escrow flow are demo-only. A production P2P marketplace requires server-created orders, verified merchants, payment instructions, dispute handling and backend-controlled escrow release.</p></div>`;
      return;
    }
    root.innerHTML = `<div class="stack">
      <div class="row between"><label class="field grow"><span>I pay with</span><select class="input" id="p-cur">${Object.keys(RATES).map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div id="p-list" class="stack"></div>
      <p class="note">${PT.icon('shield', 16)}<span>Demo marketplace only. No real merchants, payment instructions or escrow are connected. Rates are illustrative.</span></p></div>`;
    const cur = () => u.$('#p-cur', root).value;
    function list() {
      const c = cur();
      u.$('#p-list', root).innerHTML = MERCHANTS.map((m, i) => {
        const rate = RATES[c] * m[4];
        return `<div class="merchant"><div class="grow"><b>${u.esc(m[0])}</b> <span class="muted small">${m[1].toFixed(1)} rating · ${u.compact(m[2])} orders · ${m[3]}% completion</span>
        <div class="small muted">${m[5].map(u.esc).join(', ')} · Limit ${LIM.p2pMin} to ${LIM.p2pMax.toLocaleString('en-US')} USDT</div></div>
        <div class="right"><b>${fmtRate(rate)} ${c}</b><small class="muted">per USDT</small></div>
        <button class="btn primary sm" data-i="${i}">Buy</button></div>`;
      }).join('');
    }
    u.$('#p-cur', root).onchange = list; list();
    // Assigned (not added) so going Back and re-rendering never stacks duplicate handlers.
    root.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) order(+b.dataset.i); };

    function order(i) {
      const m = MERCHANTS[i], c = cur(), rate = RATES[c] * m[4];
      root.onclick = null;
      root.innerHTML = `<div class="stack">
        <button class="btn ghost sm fit" id="p-back">Back to merchants</button>
        <div class="card inset"><b>${u.esc(m[0])}</b><div class="muted small">${fmtRate(rate)} ${c} per USDT · ${m[5].map(u.esc).join(', ')}</div></div>
        <label class="field"><span>You pay (${c})</span><input class="input" id="p-pay" inputmode="decimal" value="${Math.max(1, Math.round(100 * rate))}"></label>
        <div class="row between"><span class="muted">You receive</span><b id="p-get"></b></div>
        <button class="btn primary block" id="p-go">Create order</button><div id="p-step"></div></div>`;
      const pay = u.$('#p-pay', root), get = () => (parseFloat(pay.value) || 0) / rate;
      const upd = () => (u.$('#p-get', root).textContent = get().toFixed(2) + ' USDT'); pay.oninput = upd; upd();
      u.$('#p-back', root).onclick = () => depP2P(root, modal);
      u.$('#p-go', root).onclick = () => {
        const usdt = get();
        if (usdt < LIM.p2pMin || usdt > LIM.p2pMax) return PT.ui.toast(`Order must be between ${LIM.p2pMin} and ${LIM.p2pMax.toLocaleString('en-US')} USDT.`, 'err');
        u.$('#p-go', root).remove(); pay.disabled = true;
        const payText = pay.value, step = u.$('#p-step', root);
        let left = 900;
        step.innerHTML = `<div class="card inset stack"><b>Step 1: Pay the merchant</b>
          <div class="small muted">Demo only: this does not initiate a real payment. Illustrative amount: ${u.esc(payText)} ${c}. Pay within <b id="p-timer">15:00</b>.</div>
          <button class="btn primary block" id="p-paid">I have paid</button></div>`;
        const tm = setInterval(() => {
          left--; const el = u.$('#p-timer', root);
          if (!el || left <= 0) { clearInterval(tm); if (el) PT.ui.toast('Order expired. Please create a new one.', 'err'); return; }
          el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        }, 1000);
        u.$('#p-paid', root).onclick = () => {
          clearInterval(tm);
          step.innerHTML = `<div class="card inset"><b>Step 2: Waiting for ${u.esc(m[0])} to release USDT</b><div class="small muted">No real escrow is connected. This is a simulated demo release.</div></div>`;
          if (DEMO) setTimeout(() => {
            W.creditDemo(usdt, `P2P purchase of ${usdt.toFixed(2)} USDT from ${m[0]} (${payText} ${c})`);
            PT.ui.toast(`${usdt.toFixed(2)} USDT released to your balance (demo).`, 'ok'); modal.close();
          }, 3500);
        };
      };
    }
  }

  /* ---------- Deposit: direct bank transfer ---------- */
  function depBank(root, modal) {
    const accounts = cfg.bankAccounts || {};
    const ref = refCode();
    root.innerHTML = `<div class="stack">
      <div class="row"><label class="field grow"><span>You send</span><input class="input" id="b-amt" inputmode="decimal" value="${LIM.bankMin * 5}"></label>
      <label class="field"><span>Currency</span><select class="input" id="b-cur">${Object.keys(RATES).map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div class="row between small"><span class="muted">You receive (approx.)</span><b id="b-get"></b></div>
      <div class="card inset stack small" id="b-details"></div>
      <button class="btn primary block" id="b-go">I have sent the transfer</button>
      <p class="note">${PT.icon('shield', 16)}<span>Always include the reference code so we can match your payment. Transfers are credited after the bank confirms (usually within 1 business day).</span></p></div>`;
    const g = (id) => u.$(id, root);
    const calc = () => { const a = parseFloat(g('#b-amt').value) || 0, c = g('#b-cur').value, usdt = a / RATES[c]; g('#b-get').textContent = usdt.toFixed(2) + ' USDT'; return { a, c, usdt }; };
    function details() {
      const c = g('#b-cur').value, acc = accounts[c];
      g('#b-details').innerHTML = acc
        ? `<b>Pay to</b>${Object.entries(acc).map(([k, v]) => `<div class="row between"><span class="muted">${u.esc(k)}</span><b>${u.esc(v)}</b></div>`).join('')}
           <div class="row between"><span class="muted">Reference</span><b>${u.esc(ref)}</b></div>`
        : `<span class="muted">Bank details for ${u.esc(c)} are issued by your backend in production.</span><div class="row between"><span class="muted">Reference</span><b>${u.esc(ref)}</b></div>`;
    }
    g('#b-amt').oninput = calc;
    g('#b-cur').onchange = () => { calc(); details(); };
    calc(); details();
    g('#b-go').onclick = async () => {
      const { a, c, usdt } = calc();
      if (usdt < LIM.bankMin) return PT.ui.toast(`Minimum bank deposit is ${LIM.bankMin} USDT equivalent.`, 'err');
      g('#b-go').disabled = true;
      const r = await api('bankDeposit', { amount: a, currency: c, reference: ref });
      if (r.ok) {
        PT.store.log('deposit', `Bank deposit of ${a} ${c} pending (ref ${ref})`); PT.store.commit();
        PT.ui.toast('Transfer reported. We will credit USDT once the bank confirms.', 'ok'); modal.close();
      } else if (DEMO) {
        if (W.creditDemo(usdt, `Bank transfer ${a} ${c} → ${usdt.toFixed(2)} USDT (ref ${ref})`)) { PT.ui.toast(`${usdt.toFixed(2)} USDT credited (demo).`, 'ok'); modal.close(); }
      } else {
        g('#b-go').disabled = false;
        PT.ui.toast(r.none ? 'Bank deposits are not enabled yet.' : 'Could not record your transfer. Try again.', 'err');
      }
    };
  }

  /* ---------- Deposit: PayPal ---------- */
  function depPayPal(root, modal) {
    root.innerHTML = `<div class="stack">
      <div class="row"><label class="field grow"><span>You pay</span><input class="input" id="pp-amt" inputmode="decimal" value="100"></label>
      <label class="field"><span>Currency</span><select class="input" id="pp-cur">${['USD', 'EUR', 'GBP'].map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div class="card inset stack small"><div class="row between"><span class="muted">PayPal fee (${(FEES.paypal * 100).toFixed(1)}%)</span><b id="pp-fee"></b></div>
      <div class="row between"><span class="muted">You receive</span><b id="pp-get"></b></div></div>
      <button class="btn primary block" id="pp-go">Continue to PayPal</button>
      <p class="note">${PT.icon('shield', 16)}<span>You complete the payment on PayPal's own page. ProTrader never sees your PayPal login or card details.</span></p></div>`;
    const g = (id) => u.$(id, root);
    const calc = () => {
      const a = parseFloat(g('#pp-amt').value) || 0, c = g('#pp-cur').value, fee = a * FEES.paypal, usdt = (a - fee) / RATES[c];
      g('#pp-fee').textContent = fee.toFixed(2) + ' ' + c; g('#pp-get').textContent = usdt.toFixed(2) + ' USDT'; return { a, c, usdt };
    };
    g('#pp-amt').oninput = calc; g('#pp-cur').onchange = calc; calc();
    g('#pp-go').onclick = async () => {
      const { a, c, usdt } = calc();
      if (a / RATES[c] < LIM.paypalMin) return PT.ui.toast(`Minimum PayPal deposit is ${LIM.paypalMin} USD equivalent.`, 'err');
      g('#pp-go').disabled = true; g('#pp-go').textContent = 'Opening PayPal…';
      const r = await api('paypalCheckout', { amount: a, currency: c });
      if (r.ok && r.data && /^https:\/\//.test(r.data.url || '')) { window.location.assign(r.data.url); return; }
      if (DEMO) {
        setTimeout(() => { if (W.creditDemo(usdt, `PayPal ${a} ${c} → ${usdt.toFixed(2)} USDT`)) { PT.ui.toast(`${usdt.toFixed(2)} USDT credited (demo).`, 'ok'); modal.close(); } }, 1500);
      } else {
        g('#pp-go').disabled = false; g('#pp-go').textContent = 'Continue to PayPal';
        PT.ui.toast(r.none ? 'PayPal deposits are not enabled yet.' : 'Could not start PayPal checkout. Try again.', 'err');
      }
    };
  }

  /* ---------- Deposit: card ---------- */
  function depCard(root, modal) {
    root.innerHTML = `<div class="stack">
      <div class="row"><label class="field grow"><span>You pay</span><input class="input" id="c-amt" inputmode="decimal" value="100"></label>
      <label class="field"><span>Currency</span><select class="input" id="c-cur">${['USD', 'EUR', 'GBP'].map((c) => `<option>${c}</option>`).join('')}</select></label></div>
      <div class="card inset stack small"><div class="row between"><span class="muted">Provider fee (${(FEES.cardProvider * 100).toFixed(1)}%)</span><b id="c-fee"></b></div>
      <div class="row between"><span class="muted">You receive</span><b id="c-get"></b></div></div>
      <button class="btn primary block" id="c-go">Continue to secure payment</button>
      <p class="note">${PT.icon('shield', 16)}<span>Card details are entered on your payment partner's page (for example MoonPay, Transak or Banxa). ProTrader never sees or stores card numbers.</span></p></div>`;
    const g = (id) => u.$(id, root);
    const calc = () => {
      const a = parseFloat(g('#c-amt').value) || 0, c = g('#c-cur').value, fee = a * FEES.cardProvider, usdt = (a - fee) / RATES[c];
      g('#c-fee').textContent = fee.toFixed(2) + ' ' + c; g('#c-get').textContent = usdt.toFixed(2) + ' USDT'; return { a, c, usdt };
    };
    g('#c-amt').oninput = calc; g('#c-cur').onchange = calc; calc();
    g('#c-go').onclick = async () => {
      const { a, c, usdt } = calc();
      if (a / RATES[c] < LIM.cardMin) return PT.ui.toast(`Minimum card purchase is ${LIM.cardMin} USD equivalent.`, 'err');
      g('#c-go').disabled = true; g('#c-go').textContent = 'Opening payment partner…';
      const r = await api('cardCheckout', { amount: a, currency: c });
      if (r.ok && r.data && /^https:\/\//.test(r.data.url || '')) { window.location.assign(r.data.url); return; }
      if (DEMO) {
        setTimeout(() => { if (W.creditDemo(usdt, `Card purchase ${a} ${c} → ${usdt.toFixed(2)} USDT`)) { PT.ui.toast(`${usdt.toFixed(2)} USDT credited (demo).`, 'ok'); modal.close(); } }, 2000);
      } else {
        g('#c-go').disabled = false; g('#c-go').textContent = 'Continue to secure payment';
        PT.ui.toast(r.none ? 'Card purchases are not enabled yet.' : 'Could not open the payment page. Try again.', 'err');
      }
    };
  }
})();