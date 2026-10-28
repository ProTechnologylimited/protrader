/* App state, persisted to localStorage (demo mode). */
(function () {
  const PT = window.PT;
  const KEY = 'protrader.v1';

  function defaults() {
    return {
      balances: { USDT: PT.config.startingUSDT },
      orders: [], history: [], launches: null, holdings: {},
      staking: [], pool: [], bots: [], claims: {}, submissions: [], brand: null, theme: null,
    };
  }
  let state;
  function load() {
    try { state = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { state = defaults(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }
  let timer;
  function touch() { clearTimeout(timer); timer = setTimeout(save, 400); }
  function commit() { touch(); PT.bus.emit('state'); }

  PT.store = {
    get s() { return state; },
    load, touch, commit,
    reset() { localStorage.removeItem(KEY); location.reload(); },
    bal(sym) { return state.balances[sym] || 0; },
    credit(sym, amt) { state.balances[sym] = (state.balances[sym] || 0) + amt; },
    debit(sym, amt) {
      const have = state.balances[sym] || 0;
      if (have < amt - 1e-9) return false;
      state.balances[sym] = Math.max(0, have - amt);
      return true;
    },
    log(type, text, extra) {
      state.history.unshift(Object.assign({ t: Date.now(), type, text }, extra || {}));
      if (state.history.length > 200) state.history.length = 200;
    },
  };
  load();
})();
