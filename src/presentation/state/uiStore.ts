import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Presentation-only state. Domain data lives in GraphStore; this store holds
 * selection, panels, focus mode and viewer preferences. High-frequency 3D
 * values (camera pose, hover projection) never go through here.
 */
export type FocusLevel = 1 | 2;
export type SidePanel = 'none' | 'notifications' | 'settings' | 'primaries';
export type LabelDensity = 'low' | 'balanced' | 'high';
export type MotionPref = 'system' | 'reduced' | 'full';

export type CameraRequest =
  | { kind: 'fly'; nodeId: string; seq: number }
  | { kind: 'focus'; nodeId: string; seq: number }
  | { kind: 'restore'; seq: number }
  | { kind: 'reset'; seq: number };

/** CameraRequest without `seq`, distributed over each variant (plain Omit would drop variant fields). */
export type CameraRequestInput = CameraRequest extends infer R ? (R extends unknown ? Omit<R, 'seq'> : never) : never;

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  action?: { label: string; run: () => void };
  /** ms; 0 = sticky */
  duration: number;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  detail?: string;
  actions: Array<{ label: string; tone: 'danger' | 'default' | 'primary'; run: () => void }>;
}

interface Prefs {
  labelDensity: LabelDensity;
  motion: MotionPref;
  ambient: boolean;
}

interface UiState {
  selectedId: string | null;
  hoveredId: string | null;
  detailsOpen: boolean;
  panel: SidePanel;
  focus: { active: boolean; level: FocusLevel };
  addOpen: boolean;
  addParentId: string | null;
  linkFromId: string | null;
  cameraRequest: CameraRequest | null;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  prefs: Prefs;
  /** View filter: render only top-level ideas (no branches, no links). Never touches data; not persisted. */
  primaryOnly: boolean;

  setPrimaryOnly(on: boolean): void;
  select(id: string | null, opts?: { fly?: boolean; open?: boolean }): void;
  hover(id: string | null): void;
  closeDetails(): void;
  setPanel(p: SidePanel): void;
  togglePanel(p: SidePanel): void;
  enterFocus(level?: FocusLevel): boolean;
  exitFocus(): void;
  setFocusLevel(level: FocusLevel): void;
  openAdd(parentId: string | null): void;
  closeAdd(): void;
  startLink(fromId: string): void;
  cancelLink(): void;
  requestCamera(req: CameraRequestInput): void;
  toast(t: Omit<Toast, 'id' | 'duration' | 'tone'> & Partial<Pick<Toast, 'duration' | 'tone'>>): number;
  dismissToast(id: number): void;
  askConfirm(c: ConfirmRequest | null): void;
  setPrefs(p: Partial<Prefs>): void;
}

let seq = 0;
let toastSeq = 0;

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      selectedId: null,
      hoveredId: null,
      detailsOpen: false,
      panel: 'none',
      focus: { active: false, level: 1 },
      addOpen: false,
      addParentId: null,
      linkFromId: null,
      cameraRequest: null,
      toasts: [],
      confirm: null,
      prefs: { labelDensity: 'balanced', motion: 'system', ambient: true },
      primaryOnly: false,

      setPrimaryOnly(on) {
        // Focus Mode is about relationships, which the overview hides: leave focus when entering the overview.
        if (on && get().focus.active) get().exitFocus();
        set({ primaryOnly: on });
      },

      select(id, opts = {}) {
        const { focus } = get();
        set({ selectedId: id, detailsOpen: id ? (opts.open ?? true) : false });
        if (!id && focus.active) get().exitFocus();
        if (id && focus.active) set({ cameraRequest: { kind: 'focus', nodeId: id, seq: ++seq } });
        else if (id && opts.fly) set({ cameraRequest: { kind: 'fly', nodeId: id, seq: ++seq } });
      },
      hover: (id) => {
        if (get().hoveredId !== id) set({ hoveredId: id });
      },
      closeDetails: () => set({ detailsOpen: false }),
      setPanel: (panel) => set({ panel }),
      togglePanel: (p) => set({ panel: get().panel === p ? 'none' : p }),
      enterFocus(level) {
        const { selectedId, focus } = get();
        if (!selectedId) return false;
        if (get().primaryOnly) set({ primaryOnly: false }); // relationships must be visible to focus on them
        set({ focus: { active: true, level: level ?? focus.level }, detailsOpen: true, cameraRequest: { kind: 'focus', nodeId: selectedId, seq: ++seq } });
        return true;
      },
      exitFocus() {
        if (!get().focus.active) return;
        set({ focus: { ...get().focus, active: false }, cameraRequest: { kind: 'restore', seq: ++seq } });
      },
      setFocusLevel(level) {
        const { focus, selectedId } = get();
        set({ focus: { ...focus, level } });
        if (focus.active && selectedId) set({ cameraRequest: { kind: 'focus', nodeId: selectedId, seq: ++seq } });
      },
      openAdd: (parentId) => set({ addOpen: true, addParentId: parentId, panel: 'none' }),
      closeAdd: () => set({ addOpen: false }),
      startLink: (fromId) => set({ linkFromId: fromId }),
      cancelLink: () => set({ linkFromId: null }),
      requestCamera: (req) => set({ cameraRequest: { ...req, seq: ++seq } as CameraRequest }),
      toast(t) {
        const id = ++toastSeq;
        const toast: Toast = { tone: 'info', duration: 5000, ...t, id };
        set({ toasts: [...get().toasts.slice(-3), toast] });
        return id;
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
      askConfirm: (confirm) => set({ confirm }),
      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),
    }),
    {
      name: 'orbital-mind:ui',
      version: 1,
      partialize: (s) => ({ prefs: s.prefs }),
    },
  ),
);

/** Resolve motion preference against the OS setting. */
export function useReducedMotion(): boolean {
  const motion = useUi((s) => s.prefs.motion);
  const systemReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return motion === 'reduced' || (motion === 'system' && !!systemReduced);
}
