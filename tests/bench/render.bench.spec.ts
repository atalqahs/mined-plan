import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Rendering benchmark. Loads a synthetic graph into a throwaway in-memory store
 * (?bench=N), orbits the camera continuously and records real frame times.
 * Results are written to docs/benchmarks/latest.json. Numbers depend entirely on
 * the machine/GPU; see docs/PERFORMANCE.md for how to read them.
 */
const SIZES = [100, 500, 1000];
const MODES = (process.env.BENCH_MODES ?? 'auto,high').split(',');
const results: Record<string, unknown>[] = [];

for (const mode of MODES)
for (const n of SIZES) {
  test(`orbit ${n} nodes (${mode})`, async ({ page, browserName }) => {
    await page.goto(`/?bench=${n}${mode === 'auto' ? '' : `&quality=${mode}`}`);
    await page.locator('canvas').waitFor();
    await page.waitForFunction(() => window.__orbital && window.__orbital.nodeCount() > 0);
    await page.waitForTimeout(2500); // shader compile + first frames
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c?.getExtension('WEBGL_debug_renderer_info');
      return ext ? c!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });

    await page.evaluate(() => {
      window.__orbital!.resetFrameStats();
      window.__orbital!.startOrbit(0.5);
    });
    await page.waitForTimeout(6000);
    const orbit = await page.evaluate(() => window.__orbital!.frameStats());
    await page.evaluate(() => window.__orbital!.stopOrbit());

    // Interaction latency: select a node and enter focus, measured to the next two painted frames.
    const interaction = await page.evaluate(async () => {
      const ids = window.__orbital!.ids();
      const t0 = performance.now();
      window.__orbital!.select(ids[Math.floor(ids.length / 2)]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    });

    const memory = await page.evaluate(() => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
    });

    const tier = await page.evaluate(() => window.__orbital!.renderTier().tier);
    const row = { nodes: n, mode, tier, browser: browserName, renderer: gl, orbit, selectToPaintMs: Math.round(interaction), jsHeapMB: memory };
    results.push(row);
    console.log(JSON.stringify(row));
  });
}

test.afterAll(() => {
  mkdirSync('docs/benchmarks', { recursive: true });
  writeFileSync('docs/benchmarks/latest.json', JSON.stringify({ recordedAt: new Date().toISOString(), viewport: '1920x1080', results }, null, 2));
});
