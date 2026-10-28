/* ProTrader configuration - the main place to customise the product. */
window.PT = window.PT || {};
PT.config = {
  brand: {
    name: 'ProTrader',
    company: 'ProTechnology Limited',
  },

  /* Default colour theme, matched to protechnologylimited.com (dark surfaces, violet accent,
     cream-white text). Estimated from a screen recording, so replace with exact hex values from
     the brand guide if you have them. Users can also change colours from the palette button. */
  theme: {
    bg: '#101116',
    surface: '#1A1B22',
    text: '#F4F1EA',
    accent: '#8E82F4',
    up: '#2FD9A6',
    down: '#FF5C77',
  },

  /* DEMO MODE: all balances, prices and deposits are simulated in the browser.
     Real money flows need a licensed backend (see README). */
  demoMode: true,
  startingUSDT: 10000,
  demoDayMs: 60000,            // in demo, 1 minute = 1 "day" for staking/launchpool accrual

  fees: {
    spot: 0.001,               // 0.1% spot trading fee
    curve: 0.01,               // 1% fee on memecoin / IPO curve trades
    launchMeme: 0.01,          // 1% of seed amount (min 1 USDT)
    launchIpo: 0.02,           // 2% of listing amount
    cardProvider: 0.035,       // card on-ramp fee
  },

  launch: {
    memeSupply: 1000000000,
    memeMinSeed: 100,
    memeGraduationMcap: 69000,
    ipoMinSeed: 10000,
    ipoGraduationMcap: 5000000,
    ipoShareOptions: [100000, 1000000, 10000000],
  },

  /* Set to true to pull live crypto prices from Binance's public WebSocket. */
  liveCryptoFeed: false,

  /* Deposit addresses must be generated per user by your backend / custody provider.
     Leave empty in the prototype. */
  depositAddresses: { ethereum: '', solana: '' },
  usdtContracts: {
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },

  /* WalletConnect v2 needs a free project id from https://cloud.reown.com */
  walletConnectProjectId: '',
};
