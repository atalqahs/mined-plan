import type { AppContainer } from './container';
import { frameStats, resetFrameStats, sceneRuntime } from '@/presentation/scene3d/runtime';
import { useUi } from '@/presentation/state/uiStore';
import { detectRenderTier } from '@/presentation/scene3d/gpuTier';

declare global {
  interface Window {
    __orbital?: {
      nodeCount(): number;
      select(id: string | null): void;
      ids(): string[];
      startOrbit(speed?: number): void;
      stopOrbit(): void;
      resetFrameStats(): void;
      frameStats(): ReturnType<typeof frameStats>;
      flush(): Promise<void>;
      renderTier(): ReturnType<typeof detectRenderTier>;
      screenOf(id: string): [number, number] | null;
      positionOf(id: string): [number, number, number] | null;
    };
  }
}

/** Small automation surface for e2e tests and benchmarks (no data mutation helpers). */
export function installDebugApi(c: AppContainer) {
  window.__orbital = {
    nodeCount: () => c.store.getSnapshot().nodes.size,
    ids: () => [...c.store.getSnapshot().nodes.keys()],
    select: (id) => useUi.getState().select(id),
    startOrbit: (speed = 0.6) => {
      sceneRuntime.autoOrbit = speed;
    },
    stopOrbit: () => {
      sceneRuntime.autoOrbit = 0;
    },
    resetFrameStats,
    frameStats,
    flush: () => c.store.flush(),
    renderTier: () => detectRenderTier(),
    positionOf: (id) => c.store.getSnapshot().nodes.get(id)?.position ?? null,
    screenOf: (id) => {
      const n = c.store.getSnapshot().nodes.get(id);
      return n && sceneRuntime.project ? sceneRuntime.project(n.position) : null;
    },
  };
}
