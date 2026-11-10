
/* App shell: customer authentication, header, navigation, router and boot. */
(function () {
  'use strict';

  const PT = window.PT;

  if (!PT || !PT.u) {
    console.error('ProTrader app shell: application utilities are not available.');
    return;
  }

  const u = PT.u;

  const NAV = [
    ['trade', 'Trade', '#/trade'],
    ['meme', 'Memecoins', '#/meme'],
    ['ipo', 'IPOs', '#/ipo'],
    ['airdrops', 'Airdrops', '#/airdrops'],
    ['earn', 'Earn', '#/earn'],
    ['bots', 'Bots', '#/bots'],
    ['community', 'Community', '/community']
  ];

  let cleanup = null;
  let current = null;
  let booted = false;
  let authenticated = false;
  let customer = null;
  let authMode = 'login';
  let authBusy = false;
  let marketStarted = false;

  const config = () => PT.config || {};
  const store = () => PT.store || {};
  const wallet = () => PT.wallet || {};

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function brandName() {
    const saved = store().s?.brand;
    const configured = config().brand?.name;
    return String(saved || configured || 'ProTrader');
  }

  function companyName() {
    return String(config().brand?.company || 'ProTechnology Limited');
  }

  function authApiBase() {
    return String(
      config().endpoints?.customerAuthApi ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');
  }

  async function authRequest(path, body) {
    const options = {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;

    try {
      response = await fetch(authApiBase() + path, options);
    } catch {
      throw new Error(
        'Cannot reach the ProTrader authentication server. Make sure the backend is running on port 3001.'
      );
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      // The server may return an empty or non-JSON response.
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        `Request failed (${response.status}). Please try again.`
      );
    }

    return data;
  }

  function setShellVisible(visible) {
    const display = visible ? '' : 'none';

    ['#topbar', '#foot', '#tabbar'].forEach((selector) => {
      const element = u.$(selector);
      if (element) element.style.display = display;
    });
  }

  function applyCustomerState(nextCustomer) {
    if (
      !nextCustomer ||
      nextCustomer.id == null ||
      !String(nextCustomer.id).trim()
    ) {
      throw new Error('The server returned an invalid customer account.');
    }

    customer = {
      id: String(nextCustomer.id),
      email: String(nextCustomer.email || '')
    };

    store().useCustomer(customer.id);
    authenticated = true;

    if (PT.theme?.apply) {
      PT.theme.apply(store().s.theme || config().theme);
    }

    if (PT.launch?.ensureSeed) {
      PT.launch.ensureSeed();
    }
  }

  function clearCustomerState() {
    authenticated = false;
    customer = null;

    if (typeof store().useGuest === 'function') {
      store().useGuest();
    }
  }

  function showAuthError(message) {
    const error = u.$('#auth-error');

    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearAuthError() {
    const error = u.$('#auth-error');

    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }

  function renderAuth() {
    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (error) {
        console.error('Page cleanup failed:', error);
      }
    }

    cleanup = null;
    current = null;

    setShellVisible(false);

    const root = u.$('#view');
    if (!root) return;

    root.dataset.page = 'auth';

    const registering = authMode === 'register';

    root.innerHTML = `
      <section class="page" style="max-width:520px;margin:40px auto;">
        <div class="card stack" style="padding:28px;">
          <div class="stack" style="gap:6px;text-align:center;">
            <div class="brand" style="justify-content:center;font-size:25px;">
              <span>${u.esc(brandName())}</span>
            </div>

            <h1 style="margin:12px 0 0;">
              ${registering ? 'Create your account' : 'Welcome back'}
            </h1>

            <p class="muted">
              ${registering
                ? 'Register to access your ProTrader dashboard.'
                : 'Sign in to continue to your ProTrader dashboard.'}
            </p>
          </div>

          <div
            id="auth-error"
            class="note"
            role="alert"
            aria-live="polite"
            hidden
          ></div>

          <form id="customer-auth-form" class="stack">
            <label class="field">
              <span>Email address</span>
              <input
                class="input"
                type="email"
                name="email"
                placeholder="you@example.com"
                autocomplete="email"
                maxlength="254"
                required
              >
            </label>

            <label class="field">
              <span>Account password</span>
              <input
                class="input"
                type="password"
                name="password"
                placeholder="${registering ? 'Create a password' : 'Enter your password'}"
                autocomplete="${registering ? 'new-password' : 'current-password'}"
                minlength="${registering ? '12' : '1'}"
                maxlength="200"
                required
              >
            </label>

            ${registering ? `
              <label class="field">
                <span>Confirm account password</span>
                <input
                  class="input"
                  type="password"
                  name="confirmPassword"
                  placeholder="Enter your password again"
                  autocomplete="new-password"
                  minlength="12"
                  maxlength="200"
                  required
                >
              </label>

              <p class="muted" style="font-size:12px;">
                Your account password must contain between 12 and 200
                characters. ProTrader never asks for your crypto wallet's
                12-word recovery phrase.
              </p>
            ` : ''}

            <button
              class="btn primary block"
              type="submit"
              id="auth-submit"
            >
              ${registering ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div style="text-align:center;">
            <span class="muted">
              ${registering ? 'Already have an account?' : 'New to ProTrader?'}
            </span>
            <button
              class="btn ghost sm"
              type="button"
              id="auth-switch"
            >
              ${registering ? 'Sign in' : 'Create account'}
            </button>
          </div>

          <div class="note">
            <strong>Your crypto recovery phrase stays private.</strong>
            Connect an existing Web3 wallet after signing in. Wallet
            recovery must only be performed inside your trusted wallet
            application. Never share your recovery phrase or private keys.
          </div>

          <p class="muted" style="font-size:12px;text-align:center;">
            ${u.esc(companyName())} · Prototype with simulated trading data.
          </p>
        </div>
      </section>
    `;

    document.title =
      (registering ? 'Create account' : 'Sign in') +
      ' · ' + brandName();

    const form = u.$('#customer-auth-form', root);
    const switchButton = u.$('#auth-switch', root);

    if (switchButton) {
      switchButton.onclick = () => {
        if (authBusy) return;

        authMode = registering ? 'login' : 'register';
        renderAuth();
      };
    }

    if (form) {
      form.onsubmit = handleAuthSubmit;
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (authBusy) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const confirmation = String(
      formData.get('confirmPassword') || ''
    );

    clearAuthError();

    if (!email || !password) {
      showAuthError('Enter your email address and account password.');
      return;
    }

    if (authMode === 'register') {
      if (password.length < 12 || password.length > 200) {
        showAuthError(
          'Your account password must contain between 12 and 200 characters.'
        );
        return;
      }

      if (password !== confirmation) {
        showAuthError('The account passwords do not match.');
        return;
      }
    }

    const submitButton = u.$('#auth-submit');

    authBusy = true;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = authMode === 'register'
        ? 'Creating account…'
        : 'Signing in…';
    }

    try {
      const endpoint = authMode === 'register'
        ? '/api/customer/register'
        : '/api/customer/login';

      const credentials = {
        email,
        passphrase: password
      };

      if (authMode === 'register') {
        credentials.confirmPassphrase = confirmation;
      }

      const result = await authRequest(endpoint, credentials);

      if (!result.customer) {
        throw new Error(
          'The authentication server did not return a customer account.'
        );
      }

      applyCustomerState(result.customer);

      authBusy = false;

      setShellVisible(true);
      header();
      footer();
      tabbar();

      if (!marketStarted && PT.market?.start) {
        PT.market.start();
        marketStarted = true;
      }

      if (location.hash && location.hash !== '#/trade') {
        route();
      } else {
        location.hash = '#/trade';
        route();
      }

      if (PT.ui?.toast) {
        PT.ui.toast(
          authMode === 'register'
            ? 'Your account has been created.'
            : 'Welcome back.',
          'ok'
        );
      }

    } catch (error) {
      console.error('Customer authentication failed:', error);
      showAuthError(error.message || 'Authentication failed.');

      authBusy = false;

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = authMode === 'register'
          ? 'Create account'
          : 'Sign in';
      }
    }
  }

  async function logoutCustomer() {
    if (!authenticated) return;

    const button = u.$('#h-logout');

    if (button) {
      button.disabled = true;
      button.textContent = 'Signing out…';
    }

    try {
      await authRequest('/api/customer/logout', {});
    } catch (error) {
      console.error('Customer logout request failed:', error);

      if (button) {
        button.disabled = false;
        button.textContent = 'Log out';
      }

      if (PT.ui?.toast) {
        PT.ui.toast(
          'Could not confirm logout with the server. Please try again.',
          'err'
        );
      }

      return;
    }

    clearCustomerState();
    authMode = 'login';

    if (PT.ui?.toast) {
      PT.ui.toast('You have been signed out.');
    }

    renderAuth();
  }

  function header() {
    if (!authenticated) return;

    const W = wallet();
    const balance = safeNumber(store().bal?.('USDT'), 0);
    const connected = typeof W.connected === 'function'
      ? Boolean(W.connected())
      : false;

    const address = connected ? String(W.address || '') : '';
    const demoMode = Boolean(config().demoMode);

    const topbar = u.$('#topbar');
    if (!topbar) return;

    topbar.innerHTML = `
      <a class="brand" href="#/trade" aria-label="${u.esc(brandName())} home">
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="var(--accent)"/>
          <path d="M10 24V8h7.2a5 5 0 0 1 0 10H14"
            fill="none"
            stroke="var(--on-accent)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"/>
          <path d="M17 24l7-7"
            stroke="var(--up)"
            stroke-width="3"
            stroke-linecap="round"/>
        </svg>
        <span>${u.esc(brandName())}</span>
      </a>

      <nav class="nav" aria-label="Main">
        ${NAV.map(([key, label, href]) =>
          `<a href="${href}" data-k="${key}">${label}</a>`
        ).join('')}
        <a href="#/wallet" data-k="wallet">Wallet</a>
      </nav>

      <div class="actions">
        ${demoMode
          ? '<span class="badge warn demo-badge" title="All funds and prices are simulated">Demo</span>'
          : ''}

        <button class="icon-btn" id="h-theme" aria-label="Brand colours">
          ${PT.icon('palette')}
        </button>

        <a class="balchip" href="#/wallet" title="Available demo USDT">
          ${u.usd(balance)}
        </a>

        <button class="btn ghost hide-s" id="h-dep">
          Deposit
        </button>

        ${connected
          ? `<button class="btn wallet on" id="h-wallet" aria-haspopup="true">
              <i class="dot"></i>${u.esc(u.short(address))}
            </button>`
          : `<button class="btn primary" id="h-wallet">
              Connect wallet
            </button>`}

        <button class="btn ghost sm" id="h-logout">
          Log out
        </button>
      </div>
    `;

    const themeButton = u.$('#h-theme');

    if (themeButton) {
      themeButton.onclick = () => {
        if (PT.theme?.open) PT.theme.open();
      };
    }

    const depositButton = u.$('#h-dep');

    if (depositButton) {
      depositButton.onclick = () => {
        if (typeof W.openDeposit === 'function') {
          W.openDeposit();
        }
      };
    }

    const walletButton = u.$('#h-wallet');

    if (walletButton) {
      walletButton.onclick = () => {
        if (W.connected?.()) {
          walletMenu();
        } else if (typeof W.openConnect === 'function') {
          W.openConnect();
        }
      };
    }

    const logoutButton = u.$('#h-logout');

    if (logoutButton) {
      logoutButton.onclick = logoutCustomer;
    }

    markNav();
  }

  function walletMenu() {
    const W = wallet();

    if (!PT.ui || typeof PT.ui.modal !== 'function') {
      console.error('ProTrader: wallet menu modal is unavailable.');
      return;
    }

    const address = String(W.address || '');
    const chain = String(W.chain || '');
    const isEvm = W.type === 'ethereum';

    const balance = W.balance == null
      ? null
      : safeNumber(W.balance, null);

    const balanceText = balance == null
      ? ''
      : ` · ${balance.toFixed(4)} ETH`;

    const m = PT.ui.modal({
      title: 'Connected wallet',
      size: 'sm',
      html: `
        <div class="stack">
          <div class="addrbox">
            <div>
              <small class="muted">
                ${u.esc(chain)}${u.esc(balanceText)}
              </small>
              <code>${u.esc(address)}</code>
            </div>
            <button class="btn ghost sm" id="m-copy">
              ${PT.icon('copy', 15)} Copy
            </button>
          </div>

          ${isEvm ? `
            <button class="btn primary block" id="m-verify" disabled>
              Checking verification...
            </button>
            <small
              class="muted"
              id="m-verify-status"
              aria-live="polite"
            >
              Checking saved wallet verification...
            </small>
          ` : `
            <small class="muted">
              Wallet ownership verification is currently available for Ethereum-compatible wallets.
            </small>
          `}

          <button class="btn primary block" id="m-dep">
            Deposit USDT
          </button>

          <button class="btn ghost block" id="m-out">
            Disconnect
          </button>
        </div>
      `
    });

    if (!m || !m.body) return;

    const copyButton = u.$('#m-copy', m.body);

    if (copyButton) {
      copyButton.onclick = () => {
        if (address) u.copy(address);
      };
    }

    const verifyButton = u.$('#m-verify', m.body);
    const verifyStatus = u.$('#m-verify-status', m.body);

    // Convert a wallet chain ID into a safe positive integer.
    function normalizeChainId(value) {
      if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0
          ? value
          : null;
      }

      const text = String(value || '').trim();

      if (!text) return null;

      const parsed = /^0x[0-9a-f]+$/i.test(text)
        ? Number.parseInt(text, 16)
        : Number(text);

      return Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : null;
    }

    // Restore saved verification status from the authenticated backend.
    if (isEvm && verifyButton && verifyStatus) {
      const originalAddress = address.toLowerCase();
      const originalChainId = normalizeChainId(W.chainId);
      const originalProvider = W.provider;

      (async () => {
        verifyButton.disabled = true;
        verifyButton.textContent = 'Checking verification...';
        verifyStatus.textContent = 'Checking saved wallet verification...';

        try {
          if (!authenticated) {
            throw new Error('Please sign in to check wallet verification.');
          }

          if (!originalAddress || !originalChainId) {
            throw new Error('Could not identify the connected wallet and network.');
          }

          const saved = await authRequest('/api/customer/wallets');

          if (
            !saved ||
            saved.ok !== true ||
            !Array.isArray(saved.wallets)
          ) {
            throw new Error('The server returned an invalid wallet list.');
          }

          // Confirm that the same wallet is still connected.
          const latestWallet = wallet();

          if (
            String(latestWallet.address || '').toLowerCase() !== originalAddress ||
            normalizeChainId(latestWallet.chainId) !== originalChainId ||
            latestWallet.type !== 'ethereum' ||
            latestWallet.provider !== originalProvider
          ) {
            verifyStatus.textContent =
              'The connected wallet changed. Reopen this menu to check its status.';
            verifyButton.textContent = 'Verify Wallet';
            verifyButton.disabled = true;
            return;
          }

          // A saved record must match BOTH address and network.
          const isVerified = saved.wallets.some((item) => {
            const savedAddress = String(item.address || '').trim().toLowerCase();
            const savedChainId = normalizeChainId(item.chainId);

            return (
              savedAddress === originalAddress &&
              savedChainId === originalChainId
            );
          });

          if (isVerified) {
            verifyStatus.textContent =
              'Wallet ownership successfully verified.';
            verifyButton.textContent = 'Wallet Verified';
            verifyButton.disabled = true;
          } else {
            verifyStatus.textContent =
              'Wallet connected. Ownership has not yet been verified.';
            verifyButton.textContent = 'Verify Wallet';
            verifyButton.disabled = false;
          }

        } catch (error) {
          console.error('Saved wallet verification lookup failed:', error);

          verifyStatus.textContent =
            error.message ||
            'Unable to check saved verification status. Please try again.';

          verifyButton.textContent = 'Retry verification check';
          verifyButton.disabled = false;
        }
      })();
    }

    if (verifyButton) {
      verifyButton.onclick = async () => {
        if (!W.provider || typeof W.provider.request !== 'function') {
          PT.ui.toast(
            'This wallet does not expose a signing provider. Reconnect your Ethereum wallet and try again.',
            'err'
          );
          return;
        }

        if (!W.address || !W.chainId || W.type !== 'ethereum') {
          PT.ui.toast(
            'Connect an Ethereum-compatible wallet first.',
            'err'
          );
          return;
        }

        let chainId;

        if (typeof W.chainId === 'number') {
          chainId = W.chainId;
        } else {
          const chainValue = String(W.chainId).trim();

          chainId = /^0x[0-9a-f]+$/i.test(chainValue)
            ? Number.parseInt(chainValue, 16)
            : Number(chainValue);
        }

        if (!Number.isSafeInteger(chainId) || chainId < 1) {
          PT.ui.toast(
            'Could not determine the wallet network. Reconnect and try again.',
            'err'
          );
          return;
        }

        const requestedAddress = String(W.address);
        const requestedProvider = W.provider;

        verifyButton.disabled = true;
        verifyButton.textContent = 'Preparing verification...';

        try {
          // Request a one-time challenge from the authenticated backend.
          const challenge = await authRequest(
            '/api/customer/wallet/challenge',
            {
              address: requestedAddress,
              chainId
            }
          );

          if (
            !challenge ||
            !challenge.challengeId ||
            typeof challenge.message !== 'string'
          ) {
            throw new Error(
              'The server returned an invalid wallet challenge.'
            );
          }

          // Convert the exact server message into UTF-8 hexadecimal data.
          const messageHex = '0x' + Array.from(
            new TextEncoder().encode(challenge.message),
            (byte) => byte.toString(16).padStart(2, '0')
          ).join('');

          verifyButton.textContent = 'Waiting for wallet signature...';

          // Message signature only. This does not send a transaction.
          const signature = await requestedProvider.request({
            method: 'personal_sign',
            params: [messageHex, requestedAddress]
          });

          if (
            typeof signature !== 'string' ||
            !/^0x[0-9a-f]+$/i.test(signature)
          ) {
            throw new Error(
              'The wallet did not return a valid signature.'
            );
          }

          // Ensure the connected wallet has not changed during signing.
          if (
            W.provider !== requestedProvider ||
            W.address !== requestedAddress ||
            W.type !== 'ethereum'
          ) {
            throw new Error(
              'The connected wallet changed during verification. Please try again.'
            );
          }

          verifyButton.textContent = 'Checking signature...';

          // The backend checks the signature and links the wallet.
          const result = await authRequest(
            '/api/customer/wallet/verify',
            {
              challengeId: challenge.challengeId,
              signature
            }
          );

          if (!result || result.ok !== true) {
            throw new Error(
              result?.error ||
              'The server could not verify this wallet.'
            );
          }

          if (verifyStatus) {
            verifyStatus.textContent =
              'Wallet ownership successfully verified.';
          }

          verifyButton.textContent = 'Wallet Verified';
          verifyButton.disabled = true;

          PT.ui.toast(
            'Wallet successfully verified and linked to your ProTrader account.',
            'ok'
          );

        } catch (error) {
          console.error('Wallet verification failed:', error);

          const message = error && error.code === 4001
            ? 'You rejected the wallet signature request.'
            : error.message ||
              'Wallet verification failed. Please try again.';

          if (verifyStatus) {
            verifyStatus.textContent = message;
          }

          verifyButton.disabled = false;
          verifyButton.textContent = 'Verify Wallet';

          PT.ui.toast(message, 'err');
        }
      };
    }

    const depositButton = u.$('#m-dep', m.body);

    if (depositButton) {
      depositButton.onclick = () => {
        m.close();

        if (typeof W.openDeposit === 'function') {
          W.openDeposit();
        }
      };
    }

    const disconnectButton = u.$('#m-out', m.body);

    if (disconnectButton) {
      disconnectButton.onclick = async () => {
        if (typeof W.disconnect !== 'function') return;

        disconnectButton.disabled = true;

        try {
          await W.disconnect();
          m.close();
          PT.ui.toast('Wallet disconnected.');
        } catch (error) {
          console.error('Wallet disconnect failed:', error);
          disconnectButton.disabled = false;
          PT.ui.toast(
            'Could not disconnect wallet. Please try again.',
            'err'
          );
        }
      };
    }
  }

  function tabbar() {
    const tab = u.$('#tabbar');
    if (!tab) return;

    tab.innerHTML = NAV.map(([key, label, href]) => `
      <a href="${href}" data-k="${key}">
        ${PT.icon(key)}
        <span>${label}</span>
      </a>
    `).join('');
  }

  function markNav() {
    u.$$('[data-k]', document).forEach((element) => {
      const active = element.dataset.k === current;

      element.classList.toggle('on', active);

      if (active) {
        element.setAttribute('aria-current', 'page');
      } else {
        element.removeAttribute('aria-current');
      }
    });
  }

  function footer() {
    const foot = u.$('#foot');
    if (!foot) return;

    foot.innerHTML = `
      <span>
        © ${new Date().getFullYear()} ${u.esc(companyName())}
      </span>
      <span class="muted">
        Prototype with simulated data. Trading digital assets is risky;
        you can lose everything you put in.
      </span>
    `;
  }

  function route() {
    if (!authenticated) {
      renderAuth();
      return;
    }

    setShellVisible(true);

    const rawHash = location.hash.replace(/^#\/?/, '') || 'trade';
    const parts = rawHash.split('/').filter(Boolean);

    const requestedName = parts[0] || 'trade';
    const view = PT.views && PT.views[requestedName]
      ? PT.views[requestedName]
      : PT.views?.trade;

    const name = view
      ? (PT.views[requestedName] ? requestedName : 'trade')
      : null;

    if (!view || typeof view.mount !== 'function') {
      console.error(
        'ProTrader: requested page is unavailable:',
        requestedName
      );
      return;
    }

    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (error) {
        console.error('Page cleanup failed:', error);
      }
    }

    cleanup = null;
    current = name;

    const root = u.$('#view');

    if (!root) {
      console.error('ProTrader: main view container #view was not found.');
      return;
    }

    root.innerHTML = '';
    root.dataset.page = name;

    try {
      const result = view.mount(root, parts.slice(1));
      cleanup = typeof result === 'function' ? result : null;
    } catch (error) {
      console.error(
        `ProTrader: failed to mount the ${name} page:`,
        error
      );

      root.innerHTML = `
        <section class="card stack">
          <h2>Unable to load this page</h2>
          <p class="muted">
            Something went wrong while opening this section.
            Please try again.
          </p>
          <button class="btn primary" id="route-retry">
            Retry
          </button>
        </section>
      `;

      const retryButton = u.$('#route-retry', root);

      if (retryButton) {
        retryButton.onclick = route;
      }
    }

    markNav();

    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }

    document.title =
      (name === 'trade'
        ? 'Trade'
        : name[0].toUpperCase() + name.slice(1)
      ) + ' · ' + brandName();
  }

  async function restoreCustomerSession() {
    try {
      const result = await authRequest('/api/customer/me');

      if (result.authenticated && result.customer) {
        applyCustomerState(result.customer);
        return true;
      }

      clearCustomerState();
      return false;

    } catch (error) {
      console.error('Could not restore customer session:', error);

      clearCustomerState();
      authMode = 'login';

      renderAuth();
      showAuthError(error.message);

      const form = u.$('#customer-auth-form');

      if (form) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn ghost block';
        retry.textContent = 'Retry connection';

        retry.onclick = async () => {
          retry.disabled = true;
          retry.textContent = 'Checking…';

          const restored = await restoreCustomerSession();

          if (restored) {
            startAuthenticatedApp();
          } else if (u.$('#auth-error')) {
            retry.disabled = false;
            retry.textContent = 'Retry connection';
          }
        };

        form.after(retry);
      }

      return null;
    }
  }

  function startAuthenticatedApp() {
    authenticated = true;

    setShellVisible(true);

    if (PT.theme?.apply) {
      PT.theme.apply(store().s.theme || config().theme);
    }

    if (PT.launch?.ensureSeed) {
      PT.launch.ensureSeed();
    }

    footer();
    tabbar();
    header();
    route();

    if (!marketStarted && PT.market?.start) {
      PT.market.start();
      marketStarted = true;
    }
  }

  async function boot() {
    if (booted) return;
    booted = true;

    if (!PT.config || !PT.store || !PT.views || !PT.bus || !PT.market) {
      console.error(
        'ProTrader startup failed: one or more application modules are missing.'
      );
      return;
    }

    try {
      setShellVisible(false);

      const restored = await restoreCustomerSession();

      if (restored === true) {
        startAuthenticatedApp();
      } else if (restored === false) {
        authMode = 'login';
        renderAuth();
      }

      window.addEventListener('hashchange', route);

      PT.bus.on('wallet', header);
      PT.bus.on('brand', header);

      PT.bus.on('state', () => {
        if (authenticated) header();
      });

      let lastBalance = '';

      PT.bus.on('tick', () => {
        if (!authenticated) return;

        const currentBalance = u.usd(PT.store.bal('USDT'));

        if (currentBalance !== lastBalance) {
          lastBalance = currentBalance;

          const chip = u.$('.balchip');

          if (chip) {
            chip.textContent = currentBalance;
          }
        }
      });

    } catch (error) {
      console.error('ProTrader startup error:', error);
      booted = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
