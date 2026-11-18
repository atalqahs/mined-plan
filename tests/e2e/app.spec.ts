import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
}

async function loadSample(page: Page) {
  await page.getByTestId('load-sample').click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBeGreaterThan(20);
}

test('interface is Arabic and right-to-left', async ({ page }) => {
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'مِدار' })).toBeVisible();
  await expect(page.getByTestId('add-idea')).toHaveText(/إضافة فكرة/);
  await expect(page.getByTestId('focus-toggle')).toHaveText(/وضع التركيز/);
  await expect(page.getByRole('button', { name: /التنبيهات/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'الإعدادات' })).toBeVisible();
  // The brand sits at the inline start (right edge) in RTL.
  const brand = await page.getByRole('heading', { name: 'مِدار' }).boundingBox();
  expect(brand!.x).toBeGreaterThan(1500);
});

test('create an idea and a sub-idea; data survives a reload', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-idea').click();
  await page.getByTestId('add-title').fill('مشروع الكتاب');
  await page.getByTestId('add-submit').click();
  await expect(page.getByTestId('details-title')).toHaveValue('مشروع الكتاب');
  await page.getByTestId('add-child-input').fill('الفصل الأول');
  await page.getByTestId('add-child-input').press('Enter');
  await page.getByTestId('details-notes').fill('ملاحظة مهمة عن الكتاب');
  await page.getByTestId('details-notes').blur();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.evaluate(() => window.__orbital!.flush());

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(2);
  await page.getByTestId('search').fill('الكتاب');
  await page.getByTestId('search').press('Enter');
  await expect(page.getByTestId('details-title')).toHaveValue('مشروع الكتاب');
  await expect(page.getByTestId('details-notes')).toHaveValue('ملاحظة مهمة عن الكتاب');
  await expect(page.getByTestId('details-panel')).toContainText('الفصل الأول');
});

test('focus mode: direct and extended levels, exits with Escape', async ({ page }) => {
  await boot(page);
  await loadSample(page);
  await page.getByTestId('search').fill('اطلاق المنصه'); // normalised Arabic search
  await page.getByTestId('search').press('Enter');
  await expect(page.getByTestId('details-title')).toHaveValue('إطلاق المنصة الجديدة');
  await page.keyboard.press('KeyF');
  const banner = page.getByTestId('focus-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-level', '1');
  // parent + 3 children + 1 cross-link = 5 direct relations
  await expect(banner).toContainText('5 أفكار مرتبطة');
  await page.keyboard.press('Shift+KeyF');
  await expect(banner).toHaveAttribute('data-level', '2');
  await expect(banner).not.toContainText('5 أفكار');
  await page.keyboard.press('Escape');
  await expect(banner).toBeHidden();
  // Focus mode never alters data.
  expect(await page.evaluate(() => window.__orbital!.nodeCount())).toBeGreaterThan(20);
});

test('undo and redo through keyboard shortcuts', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('KeyN');
  await page.getByTestId('add-title').fill('فكرة مؤقتة');
  await page.getByTestId('add-title').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(1);
  await page.locator('canvas').click({ position: { x: 300, y: 900 } }); // move focus out of inputs
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(0);
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(1);
});

test('delete asks for confirmation and can be undone', async ({ page }) => {
  await boot(page);
  await loadSample(page);
  const before = await page.evaluate(() => window.__orbital!.nodeCount());
  await page.getByTestId('search').fill('العمل');
  await page.getByTestId('search').press('Enter');
  await page.getByTestId('delete-node').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('حذف «العمل»؟');
  await dialog.getByRole('button', { name: 'احذفها مع فروعها' }).click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBeLessThan(before - 5);
  await page.getByRole('button', { name: 'تراجع' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(before);
});

test('reminders: due reminder notifies, appears grouped, and completes', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __notes: string[] }).__notes = calls;
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) {
        calls.push(`${title}|${opts?.body ?? ''}`);
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
  await boot(page);
  await page.getByTestId('add-idea').click();
  await page.getByTestId('add-title').fill('تجديد الجواز');
  await page.getByTestId('add-submit').click();
  // A reminder 1 minute in the past fires immediately.
  const past = await page.evaluate(() => {
    const d = new Date(Date.now() - 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  await page.getByTestId('reminder-when').fill(past);
  await page.getByTestId('add-reminder').click();
  await expect(page.getByText('حان موعد: تجديد الجواز')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: string[] }).__notes.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __notes: string[] }).__notes[0])).toContain('تجديد الجواز');

  await page.getByTestId('bell').click();
  const center = page.getByTestId('notification-center');
  await expect(center.getByTestId('tab-overdue')).toContainText('1');
  await center.getByTestId('tab-overdue').click();
  await center.getByTestId('complete-reminder').click();
  await expect(center.getByTestId('tab-completed')).toContainText('1');
  await expect(center.getByTestId('tab-overdue')).toContainText('0');
});

test('JSON export and import round-trip with validation', async ({ page }, testInfo) => {
  await boot(page);
  await loadSample(page);
  const count = await page.evaluate(() => window.__orbital!.nodeCount());
  await page.getByTestId('settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.app).toBe('orbital-mind');
  expect(json.nodes).toHaveLength(count);

  // Invalid file is rejected with an Arabic message and nothing changes.
  await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('هذا الملف ليس نسخة احتياطية من مِدار.')).toBeVisible();
  expect(await page.evaluate(() => window.__orbital!.nodeCount())).toBe(count);

  // Valid import replaces the graph after confirmation.
  const small = { app: 'orbital-mind', schemaVersion: 2, nodes: [json.nodes[0]].map((n: Record<string, unknown>) => ({ ...n, parentId: null })), edges: [], reminders: [] };
  await page.getByTestId('import-file').setInputFiles({ name: 'small.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(small)) });
  await expect(page.getByTestId('confirm-dialog')).toContainText('تحتوي النسخة على 1 فكرة');
  await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(1);
  await expect(page.getByTestId('settings-panel')).toContainText('نسخ احتياطية محلية تلقائية: 1');

  // Re-import the full export.
  await page.getByTestId('import-file').setInputFiles(file);
  await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
  await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(count);
});

test('drag a node in 3D to move its branch; click selects; undo restores', async ({ page }) => {
  await boot(page);
  await loadSample(page);
  await page.waitForTimeout(1500); // camera settles
  const id = await page.evaluate(() => {
    const ids = window.__orbital!.ids();
    // a primary idea that is on screen and not hidden behind the toolbar
    return ids.find((x) => {
      const s = window.__orbital!.screenOf(x);
      return s && s[0] > 300 && s[0] < 1400 && s[1] > 200 && s[1] < 900;
    })!;
  });
  const before = await page.evaluate((x) => window.__orbital!.positionOf(x), id);
  const [sx, sy] = (await page.evaluate((x) => window.__orbital!.screenOf(x), id))!;

  // Click selects (opens the details panel).
  await page.mouse.click(sx, sy);
  await expect(page.getByTestId('details-panel')).toBeVisible();

  // Opening the panel shifts the projection centre; re-measure once it settles.
  await page.waitForTimeout(1200);
  const [dx, dy] = (await page.evaluate((x) => window.__orbital!.screenOf(x), id))!;
  expect(Math.abs(dx - sx)).toBeGreaterThan(100);

  // Drag moves the node.
  await page.mouse.move(dx, dy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(dx - i * 12, dy + i * 6);
  await page.mouse.up();
  await expect.poll(() => page.evaluate((x) => window.__orbital!.positionOf(x), id)).not.toEqual(before);

  await page.locator('canvas').click({ position: { x: 200, y: 1000 } });
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.evaluate((x) => window.__orbital!.positionOf(x), id)).toEqual(before);
});
