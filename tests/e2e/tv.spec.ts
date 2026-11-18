import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * TV presentation + phone companion. Pairing tests run over real WebRTC DataChannels
 * between two isolated browser contexts (separate IndexedDB, like two devices), using a
 * local PeerJS signaling server (`?signal=` is honoured only on localhost).
 * Viewports are simulated; no real TV or iPhone hardware is involved.
 */
const SIGNAL = 'signal=127.0.0.1:9000';
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const ui = (p: Page) => p.evaluate(() => window.__orbital!.ui());
const rendered = (p: Page) => p.evaluate(() => window.__orbital!.rendered());

async function loadSample(page: Page) {
  await page.getByTestId('load-sample').click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBeGreaterThan(20);
}

/** Opens a TV page and a phone page (separate contexts = separate local databases) and pairs them. */
async function pair(browser: Browser, opts: { phoneHasData: boolean }) {
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ar' });
  const phoneCtx = await browser.newContext({ ...IPHONE, locale: 'ar' });
  const tv = await tvCtx.newPage();
  const phone = await phoneCtx.newPage();
  if (opts.phoneHasData) {
    await phone.goto(`/?${SIGNAL}`);
    await expect(phone.locator('canvas')).toBeVisible({ timeout: 30_000 });
    await loadSample(phone);
    await phone.evaluate(() => window.__orbital!.flush());
  }
  await tv.goto(`/?tv=present&${SIGNAL}`);
  const codeEl = tv.getByTestId('pairing-code');
  await expect(codeEl).toBeVisible({ timeout: 30_000 });
  const code = (await codeEl.innerText()).trim();
  await phone.goto(`/?tv=control&${SIGNAL}`);
  await phone.getByTestId('ctl-code').fill(code);
  await phone.getByTestId('ctl-connect').click();
  await expect(tv.getByTestId('approval-prompt')).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByTestId('controller')).toHaveAttribute('data-state', 'awaiting-approval');
  return { tv, phone, code, close: async () => (await tvCtx.close(), await phoneCtx.close()) };
}

test.describe('TV presentation', () => {
  test('enter from the toolbar: chrome hidden, scene fills the 16:9 screen, double-click toggles the toolbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
    await loadSample(page);
    const before = await page.evaluate(() => window.__orbital!.nodeCount());

    await page.getByTestId('tv-mode').click();
    await expect(page.getByTestId('tv-chooser')).toContainText('عرض على التلفاز');
    await expect(page.getByTestId('tv-chooser')).toContainText('التحكم بالتلفاز');
    await page.getByTestId('tv-present').click();

    await expect(page.getByTestId('tv-presentation')).toBeVisible();
    await expect(page).toHaveURL(/tv=present/);
    // No application chrome by default.
    for (const id of ['add-idea', 'search', 'focus-toggle', 'bell', 'settings', 'primaries-toggle', 'primary-only-toggle', 'tv-toolbar']) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await page.getByTestId('pairing-dismiss').click(); // present without a phone
    await expect(page.getByTestId('pairing-card')).toHaveCount(0);

    // The canvas renders at the display's own size (edge to edge, no letterboxing).
    await expect.poll(() => page.locator('canvas').boundingBox()).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });

    // Double-click on empty space reveals, then hides, the toolbar.
    await page.waitForTimeout(800);
    await page.mouse.dblclick(80, 1040);
    await expect(page.getByTestId('tv-toolbar')).toBeVisible();
    await page.mouse.dblclick(80, 1040);
    await expect(page.getByTestId('tv-toolbar')).toHaveCount(0);

    // Double-clicking an idea does NOT toggle the toolbar.
    const id = await page.evaluate(() => window.__orbital!.ids().find((x) => {
      const s = window.__orbital!.screenOf(x);
      return s && s[0] > 200 && s[0] < 1700 && s[1] > 150 && s[1] < 950;
    })!);
    const [sx, sy] = (await page.evaluate((x) => window.__orbital!.screenOf(x), id))!;
    await page.mouse.dblclick(sx, sy);
    await page.waitForTimeout(400);
    expect((await ui(page)).tvToolbar).toBe(false);
    expect((await ui(page)).selectedId).toBe(id);

    // A drag (orbit) never toggles the toolbar.
    await page.mouse.move(100, 1000);
    await page.mouse.down();
    await page.mouse.move(400, 1000, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(100, 1000);
    await page.mouse.down();
    await page.mouse.move(400, 1000, { steps: 8 });
    await page.mouse.up();
    expect((await ui(page)).tvToolbar).toBe(false);

    // Remote/keyboard: Escape (TV "back") reveals the toolbar; exit returns to the full app with data intact.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tv-toolbar')).toBeVisible();
    await page.getByTestId('tv-exit').click();
    await expect(page.getByTestId('add-idea')).toBeVisible();
    await expect(page).not.toHaveURL(/tv=/);
    expect(await page.evaluate(() => window.__orbital!.nodeCount())).toBe(before);
  });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    test(`TV composition fills a ${size.width}×${size.height} display`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      await page.goto('/?tv=present');
      await expect(page.getByTestId('tv-presentation')).toBeVisible({ timeout: 30_000 });
      // (A fresh canvas is briefly 300×150 until it measures its container.)
      await expect.poll(() => page.locator('canvas').boundingBox()).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height });
      expect((await ui(page)).tvMode).toBe('present');
      await ctx.close();
    });
  }

  test('desktop layout is unchanged at 1920×1080 and 2560×1440', async ({ browser }) => {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
      for (const id of ['add-idea', 'search', 'focus-toggle', 'tv-mode', 'primaries-toggle', 'primary-only-toggle']) await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId('tv-mode')).toHaveText(/وضع التلفاز/);
      const tb = await page.locator('header').first().boundingBox();
      expect(tb!.height).toBeLessThanOrEqual(61); // single-row toolbar
      await ctx.close();
    }
  });

  test('phone viewports (portrait and landscape) can reach TV mode', async ({ browser }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      const ctx = await browser.newContext({ ...IPHONE, viewport });
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
      const btn = page.getByTestId('tv-mode');
      await expect(btn).toBeInViewport();
      await expect(btn).toHaveAccessibleName('وضع التلفاز');
      await btn.click();
      await page.getByTestId('tv-control').click();
      await expect(page.getByTestId('controller')).toBeVisible();
      await expect(page.getByTestId('ctl-code')).toBeInViewport();
      await ctx.close();
    }
  });
});

test.describe('phone ⇄ TV pairing over WebRTC', () => {
  test('pairs with consent, shows the phone graph, and every remote control works', async ({ browser }) => {
    const { tv, phone, close } = await pair(browser, { phoneHasData: true });
    await tv.getByTestId('approve').click();
    await expect(phone.getByTestId('ctl-consent')).toContainText('31');
    // Nothing is shared before consent: the TV still shows its own (empty) data.
    expect((await rendered(tv)).nodes).toBe(0);
    await phone.getByTestId('ctl-share').click();

    // The TV renders the phone's network from a temporary in-memory copy…
    await expect.poll(() => rendered(tv)).toEqual({ nodes: 31, hierarchyLinks: 25, crossLinks: 6 });
    await expect(tv.getByTestId('tv-presentation')).toHaveAttribute('data-source', 'phone');
    // …and never writes it into the TV's own database.
    expect(await tv.evaluate(() => window.__orbital!.nodeCount())).toBe(0);
    await expect(phone.getByTestId('ctl-connected')).toHaveText(/تم الاتصال بالتلفاز/);
    await expect(tv.getByTestId('pairing-card')).toHaveCount(0); // QR hidden after pairing

    // Orbit (touch pad) and zoom change the TV camera.
    await tv.waitForTimeout(1200);
    const pose0 = await tv.evaluate(() => window.__orbital!.camera()!.pose()!);
    const pad = await phone.getByTestId('touch-pad').boundingBox();
    await phone.mouse.move(pad!.x + pad!.width * 0.7, pad!.y + pad!.height / 2);
    await phone.mouse.down();
    await phone.mouse.move(pad!.x + pad!.width * 0.2, pad!.y + pad!.height / 2, { steps: 10 });
    await phone.mouse.up();
    await expect.poll(async () => Math.abs((await tv.evaluate(() => window.__orbital!.camera()!.pose()!)).azimuth - pose0.azimuth)).toBeGreaterThan(0.3);
    const d0 = (await tv.evaluate(() => window.__orbital!.camera()!.pose()!)).distance;
    await phone.getByTestId('ctl-zoom-in').click();
    await expect.poll(async () => (await tv.evaluate(() => window.__orbital!.camera()!.pose()!)).distance).toBeLessThan(d0 - 1);

    // Select an idea from the phone; Focus Mode (direct, extended, off).
    await phone.getByTestId('ctl-pick').click();
    await phone.getByTestId('ctl-ideas').getByRole('button', { name: 'العمل', exact: true }).click();
    await expect.poll(async () => (await ui(tv)).selectedId).not.toBeNull();
    await expect(phone.getByTestId('ctl-selected')).toHaveText('العمل');
    await phone.getByTestId('ctl-focus-1').click();
    await expect.poll(async () => (await ui(tv)).focus).toBe(true);
    await phone.getByTestId('ctl-focus-2').click();
    await expect.poll(async () => (await ui(tv)).level).toBe(2);
    await phone.getByTestId('ctl-focus-0').click();
    await expect.poll(async () => (await ui(tv)).focus).toBe(false);

    // Primary ideas only (same filter as the desktop app).
    await phone.getByTestId('ctl-primary-only').click();
    await expect.poll(() => rendered(tv)).toEqual({ nodes: 6, hierarchyLinks: 0, crossLinks: 0 });
    await phone.getByTestId('ctl-primary-only').click();
    await expect.poll(async () => (await rendered(tv)).nodes).toBe(31);

    // Toolbar visibility on the TV.
    await phone.getByTestId('ctl-toolbar').click();
    await expect(tv.getByTestId('tv-toolbar')).toBeVisible();
    await expect(phone.getByTestId('ctl-toolbar')).toHaveAttribute('aria-checked', 'true');
    await phone.getByTestId('ctl-toolbar').click();
    await expect(tv.getByTestId('tv-toolbar')).toHaveCount(0);

    // Reset view.
    await phone.getByTestId('ctl-reset').click();

    // Live sync: the phone goes back to edit (still connected); its edit reaches the TV.
    await phone.getByTestId('ctl-edit').click();
    await expect(phone.getByTestId('remote-linked-pill')).toBeVisible();
    await phone.getByTestId('add-idea').click();
    await phone.getByTestId('add-title').fill('فكرة جديدة من الهاتف');
    await phone.getByTestId('add-submit').click();
    await expect.poll(async () => (await rendered(tv)).nodes).toBe(32);
    expect(await tv.evaluate(() => window.__orbital!.nodeCount())).toBe(0); // still nothing persisted on the TV
    await phone.getByTestId('back-to-remote').click();
    await expect(phone.getByTestId('ctl-remote')).toBeVisible();

    // Disconnect: the TV drops the phone's data and offers a fresh code.
    await phone.getByTestId('ctl-disconnect').click();
    await expect.poll(async () => (await rendered(tv)).nodes).toBe(0);
    await expect(tv.getByTestId('tv-presentation')).toHaveAttribute('data-source', 'local');
    await expect(tv.getByTestId('pairing-card')).toBeVisible();
    // The phone's own data is untouched.
    await phone.goto('/');
    await expect.poll(() => phone.evaluate(() => window.__orbital?.nodeCount() ?? -1), { timeout: 30_000 }).toBe(32); // 31 + the idea added on the phone
    await close();
  });

  test('control-only session, then the phone ends TV mode', async ({ browser }) => {
    const { tv, phone, close } = await pair(browser, { phoneHasData: false });
    await tv.getByTestId('approve').click();
    await expect(phone.getByTestId('ctl-consent')).toBeVisible();
    await phone.getByTestId('ctl-control-only').click();
    await expect(phone.getByTestId('ctl-remote')).toBeVisible();
    await phone.getByTestId('ctl-exit-tv').click();
    await expect(tv.getByTestId('add-idea')).toBeVisible(); // TV is back in the normal app
    await expect(phone.getByTestId('ctl-error')).toHaveText('أنهى التلفاز وضع العرض.');
    await close();
  });

  test('the TV owner can reject a device', async ({ browser }) => {
    const { tv, phone, code, close } = await pair(browser, { phoneHasData: false });
    await tv.getByTestId('reject').click();
    await expect(phone.getByTestId('ctl-error')).toHaveText('رفض التلفاز طلب الاتصال.');
    // The rejected code is retired immediately.
    await expect(tv.getByTestId('pairing-code')).not.toHaveText(code);
    await close();
  });

  test('a wrong or invalid code is refused', async ({ browser }) => {
    const ctx = await browser.newContext({ ...IPHONE });
    const phone = await ctx.newPage();
    await phone.goto(`/?tv=control&${SIGNAL}`);
    await phone.getByTestId('ctl-code').fill('ABCDE-FGHI1');
    await expect(phone.getByTestId('ctl-connect')).toBeDisabled(); // I and 1 are not in the alphabet
    await phone.getByTestId('ctl-code').fill('ABCDE-FGHJK'); // well-formed but no such TV
    await phone.getByTestId('ctl-connect').click();
    await expect(phone.getByTestId('ctl-error')).toHaveText(/لم يُعثر على تلفاز بهذا الرمز/, { timeout: 30_000 });
    await ctx.close();
  });

  test('the QR link pairs directly (code read from the URL fragment, then removed)', async ({ browser }) => {
    const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvCtx.newPage();
    await tv.goto(`/?tv=present&${SIGNAL}`);
    const code = (await tv.getByTestId('pairing-code').innerText({ timeout: 30_000 })).trim();
    const phoneCtx = await browser.newContext({ ...IPHONE });
    const phone = await phoneCtx.newPage();
    await phone.goto(`/?tv=control&${SIGNAL}#pair=${code.replace('-', '')}`);
    await expect(tv.getByTestId('approval-prompt')).toBeVisible({ timeout: 30_000 });
    expect(new URL(phone.url()).hash).toBe(''); // the code doesn't linger in the address bar / history
    await tvCtx.close();
    await phoneCtx.close();
  });
});
