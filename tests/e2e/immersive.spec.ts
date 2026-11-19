import { expect, test, type Page } from '@playwright/test';

/**
 * Desktop presentation view ("وضع العرض"): local, chrome-free, fully interactive.
 * Not TV mode (no pairing / WebRTC) and not Focus Mode.
 */
async function boot(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('load-sample').click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(31);
  await page.waitForTimeout(1500); // camera settles
}
const pose = (p: Page) => p.evaluate(() => window.__orbital!.camera()!.pose()!);
/** Wait until the camera has stopped moving (damped transitions). */
async function settledPose(p: Page) {
  let last = await pose(p);
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(250);
    const now = await pose(p);
    if (Math.abs(now.distance - last.distance) < 0.01 && Math.abs(now.azimuth - last.azimuth) < 0.001) return now;
    last = now;
  }
  return last;
}
const ui = (p: Page) => p.evaluate(() => window.__orbital!.ui());

test.describe('desktop presentation view (وضع العرض)', () => {
  test('hides the whole interface, keeps the full scene, and works without any pairing or WebRTC', async ({ page }) => {
    const remoteRequests: string[] = [];
    page.on('request', (r) => {
      if (/peerjs|peerTransport|ControllerApp|TvPresentation/i.test(r.url())) remoteRequests.push(r.url());
    });
    await page.addInitScript(() => {
      const W = window as unknown as { RTCPeerConnection?: unknown; __rtcCreated?: number };
      W.__rtcCreated = 0;
      const Orig = W.RTCPeerConnection as (new (...a: unknown[]) => unknown) | undefined;
      if (Orig)
        W.RTCPeerConnection = new Proxy(Orig, {
          construct(target, args) {
            W.__rtcCreated! += 1;
            return Reflect.construct(target, args);
          },
        });
    });
    await boot(page);
    const before = await page.evaluate(() => window.__orbital!.rendered());

    await expect(page.getByTestId('immersive-toggle')).toHaveText(/وضع العرض/);
    await page.getByTestId('immersive-toggle').click();

    await expect(page.getByTestId('workspace')).toHaveAttribute('data-immersive', 'true');
    // Toolbar, search, buttons, panels and banners are gone.
    await expect(page.locator('header')).toBeHidden();
    await expect(page.getByTestId('search')).toBeHidden();
    await expect(page.getByTestId('add-idea')).toBeHidden();
    await expect(page.getByTestId('immersive-toggle')).toBeHidden();
    await expect(page.getByTestId('settings')).toBeHidden();
    // The brain, every idea, its links and labels remain, filling the window.
    const box = await page.locator('canvas').boundingBox();
    const vp = page.viewportSize()!;
    expect(box).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
    expect(await page.evaluate(() => window.__orbital!.rendered())).toEqual(before);
    await expect.poll(() => page.locator('[class*="labels"] > *:visible').count()).toBeGreaterThan(3);
    // Not TV mode, not Focus Mode; local data only.
    expect(await ui(page)).toMatchObject({ immersive: true, tvMode: 'off', focus: false });
    expect(await page.evaluate(() => (window as unknown as { __rtcCreated: number }).__rtcCreated)).toBe(0);
    expect(remoteRequests).toEqual([]);
    expect(new URL(page.url()).searchParams.get('tv')).toBeNull();
  });

  test('the scene stays interactive: rotate, zoom and select with the mouse', async ({ page }) => {
    await boot(page);
    await page.getByTestId('immersive-toggle').click();
    await page.waitForTimeout(1500); // entry reframe settles
    const p0 = await pose(page);

    // Drag on empty space rotates.
    await page.mouse.move(300, 900);
    await page.mouse.down();
    await page.mouse.move(700, 900, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await pose(page)).azimuth - p0.azimuth)).toBeGreaterThan(0.2);

    // Wheel zooms.
    const d0 = (await pose(page)).distance;
    await page.mouse.move(960, 540);
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await pose(page)).distance).toBeLessThan(d0 - 1);
    await page.waitForTimeout(1200);

    // Clicking an idea selects it (the interface stays hidden).
    const id = await page.evaluate(() =>
      window.__orbital!.ids().find((x) => {
        const s = window.__orbital!.screenOf(x);
        return s && s[0] > 200 && s[0] < 1700 && s[1] > 150 && s[1] < 950;
      }),
    );
    expect(id).toBeTruthy();
    const [sx, sy] = (await page.evaluate((x) => window.__orbital!.screenOf(x), id!))!;
    await page.mouse.click(sx, sy);
    await expect.poll(async () => (await ui(page)).selectedId).toBe(id);
    await expect(page.getByTestId('details-panel')).toBeHidden();
    await expect(page.locator('header')).toBeHidden();
  });

  test('a subtle exit control appears on mouse movement; Escape and the control both restore the workspace', async ({ page }) => {
    await boot(page);
    const p0 = await settledPose(page);
    await page.getByTestId('immersive-toggle').click();
    const wrap = page.getByTestId('immersive-exit-wrap');
    await expect(wrap).toHaveAttribute('data-visible', 'true'); // shown briefly on entry
    await expect(wrap).toHaveAttribute('data-visible', 'false', { timeout: 6000 }); // fades when the mouse rests
    await page.mouse.move(400, 400);
    await page.mouse.move(420, 410);
    await expect(wrap).toHaveAttribute('data-visible', 'true');
    await expect(page.getByTestId('immersive-exit')).toHaveText(/الخروج من وضع العرض/);

    // Escape: the standard workspace returns; the untouched view goes back to where it was.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-immersive', 'false');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByTestId('search')).toBeVisible();
    await expect(page.getByTestId('immersive-exit')).toHaveCount(0);
    await expect.poll(async () => Math.abs((await pose(page)).distance - p0.distance), { timeout: 5000 }).toBeLessThan(0.1);

    // The exit control does the same, and selection survives the round trip.
    await page.evaluate(() => window.__orbital!.select(window.__orbital!.ids()[0]));
    await expect(page.getByTestId('details-panel')).toBeVisible();
    await page.getByTestId('search').fill('العمل'); // in-progress search text is kept
    await page.getByTestId('immersive-toggle').click();
    await expect(page.getByTestId('details-panel')).toBeHidden();
    await page.mouse.move(500, 500);
    await page.mouse.move(520, 520);
    await page.getByTestId('immersive-exit').click();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByTestId('details-panel')).toBeVisible();
    await expect(page.getByTestId('search')).toHaveValue('العمل');
    expect((await ui(page)).selectedId).not.toBeNull();
    expect(await page.evaluate(() => window.__orbital!.nodeCount())).toBe(31);
  });

  test('does not change Focus Mode: Escape leaves the presentation view first, focus stays on', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__orbital!.select(window.__orbital!.ids()[0]));
    await page.getByTestId('focus-toggle').click();
    await expect.poll(async () => (await ui(page)).focus).toBe(true);
    const p0 = await settledPose(page);
    await page.getByTestId('immersive-toggle').click();
    // A view being studied (focus framing) is kept as it is.
    expect(Math.abs((await settledPose(page)).distance - p0.distance)).toBeLessThan(0.1);
    expect(await ui(page)).toMatchObject({ immersive: true, focus: true });
    await page.keyboard.press('Escape');
    expect(await ui(page)).toMatchObject({ immersive: false, focus: true });
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await ui(page)).focus).toBe(false);
  });
});
