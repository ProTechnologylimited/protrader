import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'protrader.app',
  appName: 'ProTrader',
  // npm run build creates this directory with only public browser assets.
  // Never point Capacitor at the project root: it contains server code and .env.
  webDir: 'www',
};

export default config;
