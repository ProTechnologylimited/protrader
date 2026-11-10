/* ProTrader configuration - the main place to customise the product. */

window.PT = window.PT || {};

PT.config = {
  brand: {
    name: 'ProTrader',
    company: 'ProTechnology Limited',
  },
  theme: {
    bg: '#101116',
    surface: '#1A1B22',
    text: '#F4F1EA',
    accent: '#8E82F4',
    up: '#2FD9A6',
    down: '#FF5C77',
  },
  // Keep demo mode enabled for the public preview. Browser balances are simulated.
  demoMode: true,
  startingUSDT: 10000,
  demoDayMs: 60000,
  fees: {
    spot: 0.001,
    curve: 0.01,
    launchMeme: 0.01,
    launchIpo: 0.02,
    cardProvider: 0.035,
  },
  launch: {
    memeSupply: 1000000000,
    memeMinSeed: 100,
    memeGraduationMcap: 69000,
    ipoMinSeed: 10000,
    ipoGraduationMcap: 5000000,
    ipoShareOptions: [100000, 1000000, 10000000],
  },
  liveCryptoFeed: false,
  depositAddresses: {
    ethereum: '0x9ac7bEe266f273DacD87bdF3B737C8809BCd07BF',
    solana: 'rRANjKk65yzkgFxASS6wKD1zmMwJXSbiQ5xZYhAnkM5',
    sepoliaEth: '0xF29eC6a84B8E033B379f7B408e87696bf230A5Ba',
  },
  endpoints: {
    depositVerify: '/api/deposits/verify',
  },
  usdtContracts: {
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  walletConnectProjectId: '60a063436a3d8a76cd37fe2fef8efd78',
};
