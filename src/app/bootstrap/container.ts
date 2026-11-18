import { MindCommands } from '@/application/commands/mindCommands';
import type { Clock, MindRepository, Notifier } from '@/application/ports';
import { BackupService } from '@/application/services/backupService';
import { GraphStore, type InitReport } from '@/application/services/graphStore';
import { ReminderScheduler } from '@/application/services/reminderScheduler';
import { JsonBackupCodec } from '@/infrastructure/backup/jsonBackupCodec';
import { DexieRepository } from '@/infrastructure/database/dexieRepository';
import { MemoryRepository } from '@/infrastructure/database/memoryRepository';
import { BrowserNotifier } from '@/infrastructure/notifications/browserNotifier';
import { createId } from '@/shared/utils/id';

/** Everything the presentation layer is allowed to talk to. */
export interface AppContainer {
  store: GraphStore;
  commands: MindCommands;
  scheduler: ReminderScheduler;
  backup: BackupService;
  notifier: Notifier;
  clock: Clock;
  init: InitReport;
  /** Set when IndexedDB could not be opened; data then lives only in memory. */
  storageFailure: string | null;
  ephemeral: boolean;
}

export const systemClock: Clock = { now: () => new Date() };

export interface ContainerOptions {
  /** Use a throwaway in-memory store (benchmarks, demos). */
  ephemeral?: boolean;
}

/** Composition root: wires infrastructure adapters into application services. */
export async function createContainer(options: ContainerOptions = {}): Promise<AppContainer> {
  let repo: MindRepository;
  let storageFailure: string | null = null;
  if (options.ephemeral) repo = new MemoryRepository();
  else {
    try {
      repo = await DexieRepository.open();
    } catch (e) {
      console.error('[bootstrap] IndexedDB unavailable, falling back to memory', e);
      storageFailure = (e as Error)?.message ?? 'unknown';
      repo = new MemoryRepository();
    }
  }
  const clock = systemClock;
  const store = new GraphStore(repo);
  let init: InitReport;
  try {
    init = await store.init();
  } catch (e) {
    // A failed read must not wipe anything: continue in memory and tell the user.
    console.error('[bootstrap] failed to load data', e);
    storageFailure = (e as Error)?.message ?? 'load failed';
    repo = new MemoryRepository();
    return createFromRepo(repo, clock, storageFailure, !!options.ephemeral);
  }
  return wire(store, repo, clock, init, storageFailure, !!options.ephemeral);
}

async function createFromRepo(repo: MindRepository, clock: Clock, storageFailure: string | null, ephemeral: boolean) {
  const store = new GraphStore(repo);
  const init = await store.init();
  return wire(store, repo, clock, init, storageFailure, ephemeral);
}

function wire(store: GraphStore, repo: MindRepository, clock: Clock, init: InitReport, storageFailure: string | null, ephemeral: boolean): AppContainer {
  const commands = new MindCommands(store, clock, createId);
  const scheduler = new ReminderScheduler(store, commands, clock);
  const backup = new BackupService(store, commands, repo, new JsonBackupCodec(), clock, createId);
  return { store, commands, scheduler, backup, notifier: new BrowserNotifier(), clock, init, storageFailure, ephemeral };
}
