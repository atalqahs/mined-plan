import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import { useUi, useReducedMotion } from '@/presentation/state/uiStore';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import { t } from '@/presentation/i18n/ar';
import { buildSceneGraph, computeEmphasis } from './sceneModel';
import { detectRenderTier } from './gpuTier';
import { sceneRuntime } from './runtime';
import styles from './Scene.module.css';

// Heavy 3D code (three, drei, geometry generation) is split into its own chunk.
const SceneRoot = lazy(() => import('./SceneRoot'));

/**
 * Adapter between application state and the 3D scene. The scene receives a
 * read-only SceneGraph + Emphasis and reports intent through callbacks; it never
 * touches GraphStore, repositories or commands directly.
 */
export function SceneContainer() {
  const { commands } = useApp();
  const snapshot = useSnapshot();
  const run = useSafeCommand();
  const selectedId = useUi((s) => s.selectedId);
  const hoveredId = useUi((s) => s.hoveredId);
  const focus = useUi((s) => s.focus);
  const linkFromId = useUi((s) => s.linkFromId);
  const panelOpen = useUi((s) => s.detailsOpen && s.selectedId !== null);
  const density = useUi((s) => s.prefs.labelDensity);
  const ambient = useUi((s) => s.prefs.ambient);
  const reducedMotion = useReducedMotion();
  const [lost, setLost] = useState(false);

  // Rebuild GPU arrays only when nodes or edges change (reminder edits don't touch the scene).
  const nodes = useDeferredValue(snapshot.nodes);
  const edges = useDeferredValue(snapshot.edges);
  const primaryOnly = useUi((s) => s.primaryOnly);
  // Overview filter: a view over the same data — top-level ideas only, no branches, no links.
  const graph = useMemo(() => {
    if (!primaryOnly) return buildSceneGraph({ nodes, edges, reminders: new Map() });
    const top = new Map([...nodes].filter(([, n]) => !n.parentId || !nodes.has(n.parentId)));
    return buildSceneGraph({ nodes: top, edges: new Map(), reminders: new Map() });
  }, [nodes, edges, primaryOnly]);

  useEffect(() => {
    sceneRuntime.rendered = { nodes: graph.ids.length, hierarchyLinks: graph.hierarchy.length / 2, crossLinks: graph.cross.length / 2 };
  }, [graph]);

  // Navigating to a hidden branch (search, panels, reminders) reveals the full network, then flies there.
  const pendingFly = useRef<string | null>(null);
  useEffect(() => {
    if (primaryOnly && selectedId && nodes.has(selectedId) && !graph.index.has(selectedId)) {
      pendingFly.current = selectedId;
      useUi.getState().setPrimaryOnly(false);
    }
  }, [primaryOnly, selectedId, nodes, graph]);
  useEffect(() => {
    const id = pendingFly.current;
    if (id && graph.index.has(id)) {
      pendingFly.current = null;
      useUi.getState().requestCamera({ kind: 'fly', nodeId: id });
    }
  }, [graph]);
  const emphasis = useMemo(() => computeEmphasis(graph, selectedId, focus, linkFromId), [graph, selectedId, focus, linkFromId]);

  const indexOf = (id: string | null) => (id ? (graph.index.get(id) ?? -1) : -1);
  const quality = useMemo(() => detectRenderTier().tier, []);

  const onHover = useCallback((i: number | null) => {
    const id = i === null ? null : (graph.ids[i] ?? null);
    useUi.getState().hover(id);
    document.body.style.cursor = id ? 'pointer' : '';
  }, [graph]);

  const onSelect = useCallback(
    (i: number, { double }: { double: boolean }) => {
      const id = graph.ids[i];
      if (!id) return;
      const ui = useUi.getState();
      if (ui.linkFromId) {
        if (ui.linkFromId !== id) {
          const ok = run(() => commands.connect(ui.linkFromId!, id));
          if (ok !== undefined) ui.toast({ message: t.linkMode.done, tone: 'success' });
        }
        ui.cancelLink();
        return;
      }
      ui.select(id, { fly: double });
    },
    [graph, commands, run],
  );

  const onBackground = useCallback(() => {
    const ui = useUi.getState();
    if (ui.linkFromId) return ui.cancelLink();
    if (ui.focus.active) return; // background clicks never silently exit focus
    ui.select(null);
  }, []);

  const onReposition = useCallback(
    (i: number, position: [number, number, number]) => {
      const id = graph.ids[i];
      if (id) run(() => commands.repositionNode(id, position));
    },
    [graph, commands, run],
  );

  if (lost) return <div className={styles.error} role="alert">{t.scene.webglError}</div>;

  return (
    <Suspense fallback={<div className={styles.loading}>{t.scene.loading}</div>}>
      <SceneRoot
        graph={graph}
        emphasis={emphasis}
        selectedIndex={indexOf(selectedId)}
        hoveredIndex={indexOf(hoveredId)}
        linkSourceIndex={indexOf(linkFromId)}
        labelDensity={density}
        reducedMotion={reducedMotion}
        ambient={ambient}
        quality={quality}
        viewOffsetPx={panelOpen ? 216 : 0}
        onHover={onHover}
        onSelect={onSelect}
        onBackground={onBackground}
        onReposition={onReposition}
        onContextLost={() => setLost(true)}
      />
    </Suspense>
  );
}
