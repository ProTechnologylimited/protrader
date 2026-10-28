ProTrader by ProTechnology Limited

A responsive trading app prototype: spot markets (crypto, commodities, stocks), memecoin launchpad,
tokenized IPO listings, vetted airdrops, staking, launchpool, trading bots, wallet connect and deposits.

Status: front-end prototype in demo mode. Prices, balances, deposits, launches and bots are simulated in the
browser (saved to localStorage). No real money moves. See "Going to production" below.

Run it

No build step.

1. Unzip, open the folder in VS Code.
2. Install the Live Server extension, right-click "index.html" > Open with Live Server.
   (Or run `npx serve .` / `npm start`. Opening `index.html` directly also works.)

Internet is needed only for the Google Fonts. Wallet buttons need a browser with MetaMask / Phantom installed.

Project structure

index.html            page shell and script order
css/styles.css        all styling (theme tokens at the top)
js/config.js          brand, colours, fees, launch rules, feature flags  <- start here
js/util.js, store.js  helpers, state + persistence
js/ui.js              icons, modals, toasts, theme editor
js/market.js          simulated price feed + spot/limit order engine
js/chart.js           canvas candlestick / area charts
js/wallet.js          Ethereum + Solana connect, deposit (crypto, P2P, card), withdraw
js/views/*.js         trade, launch (memecoins + IPOs), airdrops, earn, bots, wallet
js/app.js             header, nav, router

Brand colours (ProTechnology Limited)

The default theme is matched to protechnologylimited.com (dark surfaces `#101116` / `#1A1B22`, violet accent `#8E82F4`,
cream-white text `#F4F1EA`). Values were estimated from a screen recording, so swap in exact brand hex codes if you have them.
Edit `PT.config.theme` in `js/config.js`, or use the palette button in the header (changes persist per device).
Six values drive everything: `bg`, `surface`, `text`, `accent`, `up` (buy), `down` (sell).

How the key features work

- Memecoin / IPO pricing: constant-product bonding curve. Starting price = seed / supply, so a larger launch
  amount gives a higher starting price. The seed is locked in the curve (creators cannot withdraw it).
  Rules live in `config.launch` and `config.fees`.
- Airdrops: each campaign is scored on 5 safety checks; only 5/5 gets "Verified". Advertisers submit a form and
  pay a fee; submissions sit "In review" until you build an admin approval tool.
- Earn: flexible/locked staking and launchpool. Demo clock: 1 minute = 1 day (`config.demoDayMs`).
- Bots: AI trend (moving averages + RSI rules), grid, DCA. These are rule-based in the prototype; swap `step()`
  in `js/views/bots.js` for a real model/API call.
- Live prices: set `liveCryptoFeed: true` to stream crypto prices from Binance's public WebSocket.

Wallet connection

- Ethereum (`window.ethereum`) and Solana (Phantom) connect out of the box.
- WalletConnect: install `@walletconnect/ethereum-provider` (or Reown AppKit), put your project id from
  https://cloud.reown.com in `config.walletConnectProjectId`, and call it from `PT.wallet.connectWalletConnect()`.
  This needs a bundler (Vite) or an ESM CDN import.

Going to production (what this prototype does NOT include)

1. Backend + database: accounts, authentication (2FA), order matching, ledger. Never trust browser state.
2. Custody and deposits: per-user deposit addresses, chain listeners that credit balances after confirmations,
   hot/cold wallet management, withdrawal review. Use a custody provider (Fireblocks, BitGo, etc.) if possible.
3. Fiat: card payments through a licensed on-ramp (MoonPay, Transak, Banxa, Stripe). Do not collect card numbers yourself.
   P2P needs an escrow service, dispute handling and merchant onboarding.
4. Real markets: a liquidity/price source for crypto, commodities and stocks. Stocks/commodities need a broker or
   tokenization partner.
5. Memecoin / IPO tokens: real on-chain token contracts (Solana SPL / ERC-20) and an audited curve contract.
6. Compliance: exchanges, securities offerings and token issuance are regulated. Get legal advice in each
   jurisdiction you serve and implement KYC/AML, sanctions screening, and risk disclosures before launch.
7. Security: independent audit and penetration test, rate limiting, monitoring.
