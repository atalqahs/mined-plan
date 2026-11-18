import { describe, expect, it } from 'vitest';
import { buildBenchSnapshot } from '@/app/bootstrap/sampleData';
import { computeFullLayout, placeNewNode } from '@/domain/graph/layout';
import { buildAdjacency, getNeighborhood } from '@/domain/graph/neighborhood';
import { searchNodes } from '@/application/queries/search';
import { buildSceneGraph, computeEmphasis } from '@/presentation/scene3d/sceneModel';

/** CPU-side costs of the hot paths (GPU-independent). Budgets are generous; timings are logged. */
function time(fn: () => void, runs = 5): number {
  fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t0) / runs;
}

describe('logic performance', () => {
  for (const n of [100, 500, 1000]) {
    it(`${n} nodes`, () => {
      const s = buildBenchSnapshot(n);
      const graph = buildSceneGraph(s);
      const id = [...s.nodes.keys()][Math.floor(n / 2)];
      const r = {
        layoutMs: time(() => computeFullLayout(s), 3),
        placeNewMs: time(() => placeNewNode(s, id)),
        sceneGraphMs: time(() => buildSceneGraph(s)),
        emphasisMs: time(() => computeEmphasis(graph, id, { active: true, level: 2 }, null)),
        neighborhoodMs: time(() => getNeighborhood(buildAdjacency(s), id, 2)),
        searchMs: time(() => searchNodes(s, 'فكرة رقم 5')),
      };
      console.log(`[perf] n=${n}`, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.toFixed(2))])));
      expect(r.sceneGraphMs).toBeLessThan(100);
      expect(r.emphasisMs).toBeLessThan(50);
      expect(r.layoutMs).toBeLessThan(2000);
    });
  }
});
