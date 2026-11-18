import { MindCommands } from '@/application/commands/mindCommands';
import { GraphStore } from '@/application/services/graphStore';
import { MemoryRepository } from '@/infrastructure/database/memoryRepository';

export function makeClock(start = '2026-03-10T09:00:00.000Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), set: (iso: string) => (t = new Date(iso).getTime()), advance: (ms: number) => (t += ms) };
}

export async function makeApp() {
  const repo = new MemoryRepository();
  const store = new GraphStore(repo);
  await store.init();
  const clock = makeClock();
  let i = 0;
  const commands = new MindCommands(store, clock, () => `id-${++i}`);
  return { repo, store, clock, commands };
}
