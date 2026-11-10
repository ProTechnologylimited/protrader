
/*
 * ProTrader AppKit bridge (Reown AppKit).
 * WalletConnect directory for EVM and Solana wallets.
 * Built by esbuild into js/appkit.bundle.js.
 */

import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';

import {
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc,
  sepolia,
  solana
} from '@reown/appkit/networks';

const EVM_NETS = [
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc,
  sepolia
];

let kit = null;

export function initAppKit({ projectId, adopt, release }) {
  if (kit) return kit;

  if (!projectId) {
    throw new Error('A Reown project ID is required.');
  }

  if (typeof adopt !== 'function' || typeof release !== 'function') {
    throw new Error('Wallet adopt and release callbacks are required.');
  }

  kit = createAppKit({
    projectId,

    adapters: [
      new EthersAdapter(),
      new SolanaAdapter()
    ],

    networks: [
      ...EVM_NETS,
      solana
    ],

    defaultNetwork: mainnet,

    /*
     * SHOW makes the full available wallet directory visible
     * in the AppKit connection modal.
     */
    allWallets: 'SHOW',

    metadata: {
      name: 'ProTrader',
      description: 'ProTrader trading platform',
      url: window.location.origin,
      icons: []
    },

    features: {
      analytics: false,
      email: false,
      socials: false,
      onramp: false,
      swaps: false
    },

    themeMode: 'dark'
  });

  function syncEvm() {
    const account = kit.getAccount('eip155');
    const address = account && account.address;

    if (!address) return;

    const network = kit.getCaipNetwork('eip155');
    const chainId = network && network.id
      ? '0x' + Number(network.id).toString(16)
      : null;

    adopt({
      type: 'ethereum',
      address,
      chain: (network && network.name) || 'Ethereum',
      chainId,
      provider: kit.getProvider('eip155') || null
    });
  }

  function syncSolana() {
    const account = kit.getAccount('solana');
    const address = account && account.address;

    if (!address) return;

    adopt({
      type: 'solana',
      address,
      chain: 'Solana',
      chainId: null,
      provider: kit.getProvider('solana') || null
    });
  }

  kit.subscribeAccount((state) => {
    if (state.isConnected) {
      syncEvm();
    } else {
      release('ethereum');
    }
  }, 'eip155');

  kit.subscribeAccount((state) => {
    if (state.isConnected) {
      syncSolana();
    } else {
      release('solana');
    }
  }, 'solana');

  kit.subscribeNetwork(() => {
    const wallet = window.PT && window.PT.wallet;

    if (wallet && wallet.viaKit && wallet.type === 'ethereum') {
      syncEvm();
    }
  });

  return kit;
}

export function open() {
  if (!kit) {
    throw new Error('AppKit has not been initialized.');
  }

  return kit.open();
}

export async function disconnectAll() {
  if (!kit) return;

  try {
    await kit.disconnect();
  } catch (error) {
    console.warn('AppKit disconnect warning:', error);
  }
}

export const evmChainIds = EVM_NETS.map((network) => network.id);
