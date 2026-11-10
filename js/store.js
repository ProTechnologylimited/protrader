/* App state, persisted to localStorage (demo mode only).
 *
 * IMPORTANT:
 * - This store is browser-local and is not a production financial ledger.
 * - Users can modify localStorage through their browser.
 * - Production balances, deposits, withdrawals and transactions must be
 *   validated and persisted by the backend.
 * - Each authenticated customer gets a separate demo-state storage key.
 * - The original guest state remains under the existing protrader.v1 key.
 */
(function () {
  'use strict';

  const PT = window.PT;
  const KEY = 'protrader.v1';

  if (!PT || !PT.config || !PT.bus) {
    throw new Error(
      'ProTrader store cannot start: PT.config or PT.bus is unavailable.'
    );
  }

  const STORAGE = (() => {
    try {
      const testKey = '__protrader_storage_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return localStorage;
    } catch {
      return null;
    }
  })();

  function startingBalance() {
    const value = Number(PT.config.startingUSDT);

    return Number.isFinite(value) && value >= 0
      ? value
      : 10000;
  }

  function defaults() {
    return {
      balances: {
        USDT: startingBalance(),
      },

      orders: [],
      history: [],
      launches: null,
      holdings: {},
      staking: [],
      pool: [],
      bots: [],
      claims: {},
      submissions: [],
      brand: null,
      theme: null,
    };
  }

  let state;
  let timer = null;

  // The guest key remains unchanged to preserve existing demo data.
  let activeKey = KEY;
  let activeCustomerId = null;

  function isPlainObject(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    );
  }

  function customerStorageKey(customerId) {
    const id = String(customerId ?? '').trim();

    if (!id || id.length > 128) {
      throw new Error('Invalid customer account identifier.');
    }

    return KEY + '.customer.' + encodeURIComponent(id);
  }

  function cleanBalances(value, baseBalances) {
    const result = { ...baseBalances };

    if (!isPlainObject(value)) {
      return result;
    }

    Object.keys(value).forEach((symbol) => {
      if (
        typeof symbol !== 'string' ||
        !/^[A-Za-z0-9_-]{1,20}$/.test(symbol)
      ) {
        return;
      }

      const amount = Number(value[symbol]);

      if (!Number.isFinite(amount) || amount < 0) {
        return;
      }

      result[symbol] = amount;
    });

    return result;
  }

  function cleanObject(value) {
    return isPlainObject(value) ? value : {};
  }

  function cleanArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function load() {
    const base = defaults();

    if (!STORAGE) {
      state = base;
      return;
    }

    try {
      const raw = STORAGE.getItem(activeKey);
      const saved = raw ? JSON.parse(raw) : {};

      const data = isPlainObject(saved)
        ? saved
        : {};

      state = {
        ...base,
        ...data,

        balances: cleanBalances(
          data.balances,
          base.balances
        ),

        orders: cleanArray(data.orders),
        history: cleanArray(data.history),
        staking: cleanArray(data.staking),
        pool: cleanArray(data.pool),
        bots: cleanArray(data.bots),
        submissions: cleanArray(data.submissions),

        holdings: cleanObject(data.holdings),
        claims: cleanObject(data.claims),

        launches: data.launches ?? null,
        brand: data.brand ?? null,
        theme: data.theme ?? null,
      };

    } catch (error) {
      console.warn(
        'ProTrader: saved browser state could not be loaded. Starting with defaults.',
        error
      );

      state = base;
    }
  }

  function save() {
    if (!STORAGE || !state) {
      return false;
    }

    try {
      STORAGE.setItem(activeKey, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn(
        'ProTrader: browser storage could not save the current state.',
        error
      );

      return false;
    }
  }

  function flushPendingSave() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      save();
    }
  }

  function touch() {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      save();
    }, 400);
  }

  function commit() {
    touch();

    if (PT.bus && typeof PT.bus.emit === 'function') {
      PT.bus.emit('state');
    }
  }

  function switchAccount(customerId) {
    // Finish pending writes before changing the storage key.
    flushPendingSave();

    activeCustomerId = customerId;
    activeKey = customerId === null
      ? KEY
      : customerStorageKey(customerId);

    load();

    if (PT.bus && typeof PT.bus.emit === 'function') {
      PT.bus.emit('state');
    }

    return true;
  }

  function validSymbol(symbol) {
    return (
      typeof symbol === 'string' &&
      /^[A-Za-z0-9_-]{1,20}$/.test(symbol)
    );
  }

  function validAmount(amount) {
    const value = Number(amount);

    return (
      Number.isFinite(value) &&
      value > 0
    )
      ? value
      : null;
  }

  PT.store = {
    get s() {
      return state;
    },

    get customerId() {
      return activeCustomerId;
    },

    load,

    touch,

    commit,

    // Load the demo state belonging to an authenticated customer.
    useCustomer(customerId) {
      const id = String(customerId ?? '').trim();

      if (!id || id.length > 128) {
        throw new Error(
          'Cannot switch demo state: invalid customer identifier.'
        );
      }

      if (activeCustomerId === id) {
        return true;
      }

      return switchAccount(id);
    },

    // Return to the original guest/demo state.
    useGuest() {
      if (activeCustomerId === null) {
        return true;
      }

      return switchAccount(null);
    },

    reset() {
      flushPendingSave();

      if (STORAGE) {
        try {
          STORAGE.removeItem(activeKey);
        } catch (error) {
          console.warn(
            'ProTrader: could not clear saved browser state.',
            error
          );
        }
      }

      window.location.reload();
    },

    bal(symbol) {
      if (!validSymbol(symbol)) {
        return 0;
      }

      const amount = Number(state.balances[symbol]);

      return Number.isFinite(amount) && amount >= 0
        ? amount
        : 0;
    },

    credit(symbol, amount) {
      if (!validSymbol(symbol)) {
        return false;
      }

      const value = validAmount(amount);

      if (value === null) {
        return false;
      }

      const current = Number(state.balances[symbol]) || 0;

      if (!Number.isFinite(current) || current < 0) {
        return false;
      }

      const updated = current + value;

      if (!Number.isFinite(updated)) {
        return false;
      }

      state.balances[symbol] = updated;

      return true;
    },

    debit(symbol, amount) {
      if (!validSymbol(symbol)) {
        return false;
      }

      const value = validAmount(amount);

      if (value === null) {
        return false;
      }

      const current = Number(state.balances[symbol]) || 0;

      if (!Number.isFinite(current) || current < 0) {
        return false;
      }

      // Small tolerance prevents floating-point precision errors.
      if (current < value - 1e-9) {
        return false;
      }

      state.balances[symbol] = Math.max(
        0,
        current - value
      );

      return true;
    },

    log(type, text, extra) {
      if (
        typeof type !== 'string' ||
        !type.trim() ||
        typeof text !== 'string'
      ) {
        return false;
      }

      const entry = Object.assign(
        {
          t: Date.now(),
          type: type.trim(),
          text,
        },
        isPlainObject(extra) ? extra : {}
      );

      state.history.unshift(entry);

      if (state.history.length > 200) {
        state.history.length = 200;
      }

      return true;
    },
  };

  load();
})();