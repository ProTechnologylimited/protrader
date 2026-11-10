/* Wallet / assets overview. */
(function () {
  'use strict';

  const PT = window.PT;
  const u = PT.u;

  /*
   * Safely convert values to finite numbers.
   * Invalid, negative or missing values are treated as zero.
   */
  function number(value) {
    const result = Number(value);

    return Number.isFinite(result) && result >= 0
      ? result
      : 0;
  }

  /*
   * Safely retrieve a market asset.
   */
  function marketAsset(symbol) {
    if (
      !PT.market ||
      typeof PT.market.get !== 'function'
    ) {
      return null;
    }

    try {
      return PT.market.get(symbol) || null;
    } catch {
      return null;
    }
  }

  /*
   * Safely retrieve a market price.
   */
  function marketPrice(symbol) {
    const asset = marketAsset(symbol);

    if (!asset) return null;

    const price = Number(asset.price);

    return Number.isFinite(price) && price >= 0
      ? price
      : null;
  }

  /*
   * Estimated total value of everything the user owns, in USDT.
   *
   * This is a frontend estimate based on local demo state.
   * It is not a verified production account balance.
   */
  PT.portfolio = {
    assets() {
      const S = PT.store.s;
      const out = [];

      /*
       * Spot balances and other token balances.
       */
      const balances = S.balances &&
        typeof S.balances === 'object'
        ? S.balances
        : {};

      Object.entries(balances).forEach(([sym, rawValue]) => {
        const qty = number(rawValue);

        if (qty <= 1e-9) return;

        const asset = marketAsset(sym);

        const price = sym === 'USDT'
          ? 1
          : asset
            ? marketPrice(sym)
            : null;

        out.push({
          sym,

          name: sym === 'USDT'
            ? 'Tether'
            : asset && asset.name
              ? asset.name
              : 'Airdrop token',

          qty,

          price,

          value: price === null
            ? 0
            : qty * price,
        });
      });

      /*
       * Token launch holdings.
       */
      const holdings = S.holdings &&
        typeof S.holdings === 'object'
        ? S.holdings
        : {};

      let launches = [];

      try {
        if (
          PT.launch &&
          typeof PT.launch.list === 'function'
        ) {
          launches = PT.launch.list() || [];
        }
      } catch {
        launches = [];
      }

      Object.entries(holdings).forEach(([id, rawValue]) => {
        const qty = number(rawValue);

        if (qty <= 1e-9) return;

        const token = launches.find(
          (item) => item && item.id === id
        );

        if (!token) return;

        let price = null;

        try {
          if (
            PT.launch &&
            typeof PT.launch.price === 'function'
          ) {
            const result = Number(PT.launch.price(token));

            if (
              Number.isFinite(result) &&
              result >= 0
            ) {
              price = result;
            }
          }
        } catch {
          price = null;
        }

        out.push({
          sym: token.sym || id,

          name: token.name || token.sym || 'Launch token',

          qty,

          price,

          value: price === null
            ? 0
            : qty * price,
        });
      });

      return out;
    },

    /*
     * Estimated value of staking, bots and open orders.
     */
    earning() {
      const S = PT.store.s;

      let total = 0;

      /*
       * Staking positions.
       */
      const staking = Array.isArray(S.staking)
        ? S.staking
        : [];

      staking.forEach((position) => {
        if (!position) return;

        const amount = number(position.amount);

        if (amount <= 0) return;

        let price = null;

        if (position.sym === 'USDT') {
          price = 1;
        } else {
          price = marketPrice(position.sym);
        }

        if (price === null) return;

        const value = amount * price;

        if (Number.isFinite(value)) {
          total += value;
        }
      });

      /*
       * Bot value.
       */
      try {
        if (
          PT.bots &&
          typeof PT.bots.total === 'function'
        ) {
          const botValue = number(PT.bots.total());

          total += botValue;
        }
      } catch {
        // Ignore unavailable bot valuation.
      }

      /*
       * Open orders.
       */
      const orders = Array.isArray(S.orders)
        ? S.orders
        : [];

      orders.forEach((order) => {
        if (!order) return;

        const qty = number(order.qty);

        if (qty <= 0) return;

        let value = 0;

        if (order.side === 'buy') {
          const price = number(order.price);

          value = price * qty;
        } else {
          const price = marketPrice(order.sym);

          if (price === null) return;

          value = price * qty;
        }

        if (Number.isFinite(value) && value >= 0) {
          total += value;
        }
      });

      return Number.isFinite(total) ? total : 0;
    },

    /*
     * Total estimated portfolio value.
     */
    total() {
      const assetValue = this.assets().reduce(
        (sum, asset) => {
          const value = number(asset.value);
          return sum + value;
        },
        0
      );

      const earningValue = this.earning();

      const total = assetValue + earningValue;

      return Number.isFinite(total) ? total : 0;
    },
  };

  /*
   * Wallet page.
   */
  PT.views.wallet = {
    mount(root) {
      root.innerHTML = `
        <div class="page">
          <div class="pagehead">
            <div>
              <h1>Wallet</h1>
              <p class="muted lead">
                Your balances across spot, launches, staking and bots.
              </p>
            </div>

            <div class="row">
              <button class="btn primary" id="w-dep">
                Deposit
              </button>

              <button class="btn ghost" id="w-wd">
                Withdraw
              </button>
            </div>
          </div>

          <div class="card stack">
            <small class="muted">
              Estimated total value
            </small>

            <div class="big-price" id="w-total"></div>

            <div class="stats" id="w-stats"></div>
          </div>

          <h2 class="sub">Assets</h2>

          <div class="card">
            <div class="scrollx">
              <table class="tbl" id="w-tbl"></table>
            </div>
          </div>

          <h2 class="sub">Activity</h2>

          <div class="card">
            <div id="w-act"></div>
          </div>
        </div>
      `;

      const $ = (selector) => u.$(selector, root);

      /*
       * Deposit and withdrawal actions.
       */
      $('#w-dep').onclick = () => {
        if (
          PT.wallet &&
          typeof PT.wallet.openDeposit === 'function'
        ) {
          PT.wallet.openDeposit();
        }
      };

      $('#w-wd').onclick = () => {
        if (
          PT.wallet &&
          typeof PT.wallet.openWithdraw === 'function'
        ) {
          PT.wallet.openWithdraw();
        }
      };

      /*
       * Render wallet information.
       */
      function drawWallet() {
        const P = PT.portfolio;
        const S = PT.store.s;

        const assets = P.assets().sort(
          (a, b) => number(b.value) - number(a.value)
        );

        const earningValue = P.earning();

        /*
         * Estimated total.
         */
        $('#w-total').textContent = u.usd(P.total());

        /*
         * Connected wallet information.
         */
        let connectedWallet = 'Not connected';

        try {
          if (
            PT.wallet &&
            typeof PT.wallet.connected === 'function' &&
            PT.wallet.connected()
          ) {
            connectedWallet =
              u.short(PT.wallet.address) +
              ' (' +
              String(PT.wallet.chain || 'Unknown network') +
              ')';
          }
        } catch {
          connectedWallet = 'Not connected';
        }

        /*
         * Summary statistics.
         */
        const stats = [
          [
            'Available USDT',
            u.usd(PT.store.bal('USDT')),
          ],
          [
            'Staked, in bots or orders',
            u.usd(earningValue),
          ],
          [
            'Connected wallet',
            connectedWallet,
          ],
        ];

        $('#w-stats').innerHTML = stats.map(
          ([label, value]) => `
            <div>
              <small class="muted">
                ${u.esc(label)}
              </small>

              <b>
                ${u.esc(value)}
              </b>
            </div>
          `
        ).join('');

        /*
         * Asset table.
         */
        $('#w-tbl').innerHTML = `
          <thead>
            <tr>
              <th>Asset</th>
              <th>Amount</th>
              <th>Price</th>
              <th>Value</th>
            </tr>
          </thead>

          <tbody>
            ${
              assets.length
                ? assets.map((asset) => `
                    <tr>
                      <td>
                        <b>
                          ${u.esc(asset.sym)}
                        </b>

                        <span class="muted small">
                          ${u.esc(asset.name)}
                        </span>
                      </td>

                      <td>
                        ${u.qty(asset.qty)}
                      </td>

                      <td>
                        ${
                          asset.price === null
                            ? '<span class="muted">Unpriced</span>'
                            : '$' + u.price(asset.price)
                        }
                      </td>

                      <td>
                        ${u.usd(asset.value)}
                      </td>
                    </tr>
                  `).join('')
                : `
                    <tr>
                      <td colspan="4" class="muted pad">
                        No assets yet.
                      </td>
                    </tr>
                  `
            }
          </tbody>
        `;

        /*
         * Recent activity.
         */
        const history = Array.isArray(S.history)
          ? S.history
          : [];

        $('#w-act').innerHTML = history.length
          ? `
              <table class="tbl">
                <tbody>
                  ${history.slice(0, 12).map((entry) => {
                    const description =
                      entry && typeof entry.text === 'string'
                        ? entry.text
                        : 'Activity recorded';

                    let time = '';

                    if (
                      entry &&
                      Number.isFinite(Number(entry.t))
                    ) {
                      try {
                        time = u.timeAgo(Number(entry.t));
                      } catch {
                        time = '';
                      }
                    }

                    return `
                      <tr>
                        <td>
                          ${u.esc(description)}
                        </td>

                        <td class="muted right nowrap">
                          ${u.esc(time)}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `
          : `
              <p class="muted pad">
                Nothing yet. Deposit to get started.
              </p>
            `;
      }

      /*
       * Initial render.
       */
      drawWallet();

      /*
       * Subscribe to application updates.
       */
      const off = PT.bus.on('tick', drawWallet);
      const off2 = PT.bus.on('state', drawWallet);
      const off3 = PT.bus.on('wallet', drawWallet);

      /*
       * Unsubscribe when navigating away from the Wallet page.
       */
      return () => {
        if (typeof off === 'function') off();
        if (typeof off2 === 'function') off2();
        if (typeof off3 === 'function') off3();
      };
    },
  };
})();