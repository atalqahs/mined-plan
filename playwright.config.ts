import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1920, height: 1080 },
    locale: 'ar',
    timezoneId: 'Asia/Riyadh',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        // Two browser contexts on one machine: expose real host candidates instead of mDNS names.
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
  },
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Local PeerJS signaling server — the same server software as the public PeerJS cloud.
      command: 'npx peerjs --port 9000 --host 127.0.0.1 --key peerjs --path /',
      url: 'http://127.0.0.1:9000/peerjs/id',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
