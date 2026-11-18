import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppContainer } from '@/app/bootstrap/container';
import type { GraphSnapshot } from '@/domain/entities/types';
import type { SaveStatus } from '@/application/services/graphStore';

const Ctx = createContext<AppContainer | null>(null);

export function AppProvider({ container, children }: { container: AppContainer; children: ReactNode }) {
  return <Ctx.Provider value={container}>{children}</Ctx.Provider>;
}

export function useApp(): AppContainer {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

/** Subscribe to the immutable graph snapshot (re-renders only when data changes). */
export function useSnapshot(): GraphSnapshot {
  const { store } = useApp();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useSaveStatus(): SaveStatus {
  const { store } = useApp();
  return useSyncExternalStore(
    (cb) => store.onStatus(cb),
    () => store.status,
  );
}
