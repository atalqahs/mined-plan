import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { arabicGraphBackup } from '../fixtures/arabicGraph';

/**
 * Regression tests for two production bugs reported on a real iPhone + Mi TV Stick:
 *   Bug 1 — the phone disconnected from the TV after about a minute.
 *   Bug 2 — sharing ("عرض أفكاري") a real-sized Arabic graph disconnected immediately.
 * They run over real WebRTC between two isolated browser contexts. A dedicated PeerJS
 * signaling server is started per test so it can be killed mid-session.
 */
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const rendered = (p: Page) => p.evaluate(() => window.__orbital?.rendered() ?? { nodes: -1, hierarchyLinks: -1, crossLinks: -1 });

function startSignaling(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['peerjs', '--port', String(port), '--host', '127.0.0.1', '--key', 'peerjs', '--path', '/'], { stdio: 'pipe', detached: true });
    const timer = setTimeout(() => reject(new Error('signaling server did not start')), 20_000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/peerjs/id`);
        if (res.ok) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve(child);
        }
      } catch {
        /* not up yet */
      }
    }, 300);
  });
}
function stopSignaling(child: ChildProcess) {
  try {
    process.kill(-child.pid!, 'SIGKILL'); // whole process group (npx + node)
  } catch {
    /* already gone */
  }
}

async function importGraph(page: Page) {
  await page.getByTestId('settings').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(arabicGraphBackup())) });
  await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(69);
  await page.evaluate(() => window.__orbital!.flush());
}

async function pair(browser: Browser, signal: string, opts: { withGraph: boolean }) {
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const phoneCtx = await browser.newContext({ ...IPHONE });
  const tv = await tvCtx.newPage();
  const phone = await phoneCtx.newPage();
  if (opts.withGraph) {
    await phone.goto(`/?signal=${signal}`);
    await expect(phone.locator('canvas')).toBeVisible({ timeout: 30_000 });
    await importGraph(phone);
  }
  await tv.goto(`/?tv=present&signal=${signal}`);
  const code = (await tv.getByTestId('pairing-code').innerText({ timeout: 30_000 })).trim();
  await phone.goto(`/?tv=control&signal=${signal}`);
  await phone.getByTestId('ctl-code').fill(code);
  await phone.getByTestId('ctl-connect').click();
  await tv.getByTestId('approve').click({ timeout: 30_000 });
  await expect(phone.getByTestId('ctl-consent')).toBeVisible({ timeout: 15_000 });
  return { tv, phone, code: code.replace('-', ''), close: async () => (await tvCtx.close(), await phoneCtx.close()) };
}

async function downloadLog(page: Page): Promise<string> {
  await page.getByTestId('ctl-diagnostics').locator('summary').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ctl-diag-download').click()]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('TV link regressions', () => {
  test.describe.configure({ timeout: 180_000 });

  test('Bug 2: sharing a real-sized Arabic graph (69 ideas, 18 links, ~16.5 KB UTF-8) succeeds and stays connected', async ({ browser }) => {
    const server = await startSignaling(9101);
    try {
      const { tv, phone, close } = await pair(browser, '127.0.0.1:9101', { withGraph: true });
      await expect(phone.getByTestId('ctl-consent')).toContainText('69');
      await phone.getByTestId('ctl-share').click();
      // Success is reported only after the TV validated the complete graph and put it on screen.
      await expect(phone.getByTestId('ctl-share-status')).toHaveAttribute('data-status', 'shown', { timeout: 30_000 });
      expect(await rendered(tv)).toEqual({ nodes: 69, hierarchyLinks: 61, crossLinks: 18 });
      await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', 'connected');
      // Controls still work after sharing.
      await phone.getByTestId('ctl-primary-only').click();
      await expect.poll(async () => (await rendered(tv)).nodes).toBe(8);
      await phone.getByTestId('ctl-primary-only').click();
      await expect.poll(async () => (await rendered(tv)).nodes).toBe(69);
      // Private notes never reach the TV.
      const tvText = await tv.evaluate(() => JSON.stringify(window.__orbital!.ids()));
      expect(tvText).not.toContain('ملاحظات خاصة');
      await close();
    } finally {
      stopSignaling(server);
    }
  });

  test('Bug 1: losing the signaling server mid-session does not drop the phone ⇄ TV link', async ({ browser }) => {
    const server = await startSignaling(9102);
    let killed = false;
    try {
      const { tv, phone, close } = await pair(browser, '127.0.0.1:9102', { withGraph: false });
      await phone.getByTestId('ctl-control-only').click();
      await expect(phone.getByTestId('ctl-remote')).toBeVisible();
      // Signaling is only needed to set the link up. Kill it (what happens when the server drops
      // a late heartbeat after ~60 s, or the phone's Wi-Fi/WebSocket hiccups).
      stopSignaling(server);
      killed = true;
      await phone.waitForTimeout(8000);
      await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', 'connected');
      // The peer-to-peer channel still carries commands.
      await phone.getByTestId('ctl-toolbar').click();
      await expect(tv.getByTestId('tv-toolbar')).toBeVisible({ timeout: 10_000 });
      await close();
    } finally {
      if (!killed) stopSignaling(server);
    }
  });

  test('a dropped WebRTC link resumes automatically: no second approval, graph and controls intact', async ({ browser }) => {
    const server = await startSignaling(9103);
    try {
      const { tv, phone, close, code } = await pair(browser, '127.0.0.1:9103', { withGraph: true });
      await phone.getByTestId('ctl-share').click();
      await expect.poll(() => rendered(tv), { timeout: 30_000 }).toEqual({ nodes: 69, hierarchyLinks: 61, crossLinks: 18 });
      // Kill the peer-to-peer path on the phone (like iOS suspending it, or a Wi-Fi roam).
      expect(await phone.evaluate(() => (window as unknown as { __orbitalDropLinks(): number }).__orbitalDropLinks())).toBeGreaterThan(0);
      await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', /reconnecting|connected/);
      await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
      await expect(tv.getByTestId('approve')).toHaveCount(0); // resumed with its token, not re-prompted
      await expect(phone.getByTestId('ctl-share-status')).toHaveAttribute('data-status', 'shown', { timeout: 20_000 });
      expect((await rendered(tv)).nodes).toBe(69);
      await phone.getByTestId('ctl-toolbar').click();
      await expect(tv.getByTestId('tv-toolbar')).toBeVisible({ timeout: 10_000 });
      // The phone's diagnostic log explains the drop and is privacy-safe.
      const log = await downloadLog(phone);
      expect(log).toContain('ctl.lost');
      expect(log).toContain('ctl.approved {"resumed":true}');
      expect(log).not.toMatch(/[\u0600-\u06FF]/); // no Arabic titles/notes
      expect(log).not.toContain(code);
      expect(log).not.toContain('omtv-');
      await close();
    } finally {
      stopSignaling(server);
    }
  });

  test('control-only pairing stays connected through prolonged foreground use (> 70 s)', async ({ browser }) => {
    test.setTimeout(240_000);
    const server = await startSignaling(9104);
    try {
      const { tv, phone, close } = await pair(browser, '127.0.0.1:9104', { withGraph: false });
      await phone.getByTestId('ctl-control-only').click();
      await expect(phone.getByTestId('ctl-remote')).toBeVisible();
      const t0 = Date.now();
      let toggles = 0;
      while (Date.now() - t0 < 75_000) {
        await phone.waitForTimeout(7_500);
        await phone.getByTestId('ctl-toolbar').click();
        toggles++;
        await expect(tv.getByTestId('tv-toolbar')).toHaveCount(toggles % 2 ? 1 : 0, { timeout: 10_000 });
        await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', 'connected');
      }
      // The diagnostic log recorded no drop.
      const log = await downloadLog(phone);
      expect(log).toContain('ctl.approved');
      expect(log).not.toContain('ctl.lost');
      expect(log).not.toContain('dc.close');
      await close();
    } finally {
      stopSignaling(server);
    }
  });
});
