import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, computeProof, describeDevice, generatePairingCode, normalizePairingCode, peerIdForCode, SequenceGuard, verifyProof } from '@/application/remote/pairing';
import { parseCommand, parseTvMessage } from '@/application/remote/protocol';
import { chunkGraph, fromSharedGraph, GraphAssembler, toSharedGraph } from '@/application/remote/graphShare';
import { TvSession, type TvCommandSink, type TvSessionState } from '@/application/remote/tvSession';
import { ControllerSession } from '@/application/remote/controllerSession';
import { buildBenchSnapshot, buildSampleSnapshot } from '@/app/bootstrap/sampleData';
import type { GraphSnapshot } from '@/domain/entities/types';
import { MemoryHub, settle } from './memoryTransport';

describe('pairing primitives', () => {
  it('generates unambiguous, high-entropy codes', () => {
    const codes = new Set(Array.from({ length: 500 }, generatePairingCode));
    expect(codes.size).toBe(500);
    for (const c of codes) {
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
  it('normalises typed codes and rejects invalid ones', () => {
    expect(normalizePairingCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizePairingCode(' AB CDE FGH JK ')).toBe('ABCDEFGHJK');
    expect(normalizePairingCode('ABCDE-FGHJ')).toBeNull(); // too short
    expect(normalizePairingCode('ABCDE-FGH0K')).toBeNull(); // 0 is not in the alphabet
    expect(normalizePairingCode('ABCDE-FGHIK')).toBeNull(); // I is excluded
  });
  it('derives a stable peer id that does not reveal the code', async () => {
    const id = await peerIdForCode('ABCDEFGHJK');
    expect(id).toBe(await peerIdForCode('ABCDEFGHJK'));
    expect(id).toMatch(/^omtv-[0-9a-f]{40}$/);
    expect(id.toUpperCase()).not.toContain('ABCDEFGHJK');
    expect(await peerIdForCode('ABCDEFGHJM')).not.toBe(id);
  });
  it('binds proofs to code, nonce and connection (no replay elsewhere)', async () => {
    const p = await computeProof('ABCDEFGHJK', 'n1', 'phone-1');
    expect(await verifyProof('ABCDEFGHJK', 'n1', 'phone-1', p)).toBe(true);
    expect(await verifyProof('ABCDEFGHJM', 'n1', 'phone-1', p)).toBe(false); // wrong code
    expect(await verifyProof('ABCDEFGHJK', 'n2', 'phone-1', p)).toBe(false); // replayed on a new challenge
    expect(await verifyProof('ABCDEFGHJK', 'n1', 'phone-2', p)).toBe(false); // replayed from another peer
    expect(await verifyProof('ABCDEFGHJK', 'n1', 'phone-1', 'x')).toBe(false);
  });
  it('accepts only strictly increasing sequence numbers', () => {
    const g = new SequenceGuard();
    expect(g.accept(1)).toBe(true);
    expect(g.accept(1)).toBe(false);
    expect(g.accept(0)).toBe(false);
    expect(g.accept(5)).toBe(true);
    expect(g.accept('6')).toBe(false);
  });
  it('describes devices for the approval prompt', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iphone');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 11; MiTV)')).toBe('android');
  });
});

describe('protocol validation', () => {
  it('rejects malformed and out-of-range commands', () => {
    expect(parseCommand({ t: 'orbit', az: 0.1, pol: 0, seq: 1 })).toEqual({ t: 'orbit', az: 0.1, pol: 0, seq: 1 });
    expect(parseCommand({ t: 'orbit', az: 99, pol: 0, seq: 1 })).toBeNull();
    expect(parseCommand({ t: 'zoom', factor: 100, seq: 1 })).toBeNull();
    expect(parseCommand({ t: 'select', id: 5, seq: 1 })).toBeNull();
    expect(parseCommand({ t: 'nope', seq: 1 })).toBeNull();
    expect(parseCommand({ t: 'reset' })).toBeNull(); // no seq
    expect(parseCommand({ t: 'graph-chunk', gid: 'g', i: 0, n: 1, data: 'x'.repeat(20_000), seq: 1 })).toBeNull();
    expect(parseTvMessage({ t: 'state', selectedId: null, focus: false, level: 3, primaryOnly: false, toolbar: false, source: 'local' })).toBeNull();
  });
});

describe('graph sharing', () => {
  it('shares only display data and round-trips through chunks', () => {
    const s = buildBenchSnapshot(1000);
    const first = [...s.nodes.values()][0];
    (s.nodes as Map<string, typeof first>).set(first.id, { ...first, description: 'سرّي جدًا', deadline: '2026-12-01T00:00:00Z' });
    const shared = toSharedGraph(s);
    const json = JSON.stringify(shared);
    expect(json).not.toContain('سرّي جدًا');
    expect(json).not.toContain('deadline');
    const chunks = chunkGraph(shared, 'g1');
    expect(chunks.length).toBeGreaterThan(1);
    const asm = new GraphAssembler();
    let out: unknown = null;
    for (const c of [...chunks].reverse()) out = asm.add(c) ?? out; // order-independent
    const snap = fromSharedGraph(out)!;
    expect(snap.nodes.size).toBe(1000);
    expect(snap.edges.size).toBe(s.edges.size);
    expect(snap.nodes.get(first.id)!.description).toBe('');
    expect(snap.reminders.size).toBe(0);
  });
  it('rejects invalid shared graphs', () => {
    expect(fromSharedGraph({ v: 2, nodes: [], edges: [] })).toBeNull();
    expect(fromSharedGraph({ v: 1, nodes: [{ id: 'a', title: 'x', parentId: null, position: [0, NaN, 0], status: 'active', category: '' }], edges: [] })).toBeNull();
    expect(fromSharedGraph({ v: 1, nodes: [{ id: 'a', title: '', parentId: null, position: [0, 0, 0], status: 'active', category: '' }], edges: [] })).toBeNull();
  });
});

function makeSink() {
  const calls: string[] = [];
  const graphs: Array<GraphSnapshot | null> = [];
  const sink: TvCommandSink = {
    orbit: (a, p) => calls.push(`orbit:${a.toFixed(2)},${p.toFixed(2)}`),
    zoom: (f) => calls.push(`zoom:${f}`),
    reset: () => calls.push('reset'),
    select: (id) => calls.push(`select:${id}`),
    focus: (on, l) => calls.push(`focus:${on}:${l ?? ''}`),
    primaryOnly: (on) => calls.push(`primaryOnly:${on}`),
    toolbar: (v) => calls.push(`toolbar:${v}`),
    exitTv: () => calls.push('exitTv'),
    graph: (g) => graphs.push(g),
  };
  return { sink, calls, graphs };
}

async function startPair(ttl?: number) {
  const hub = new MemoryHub();
  const { sink, calls, graphs } = makeSink();
  const tv = new TvSession(hub.transport(), sink, undefined, ttl);
  const states: TvSessionState[] = [];
  tv.onState((s) => states.push(s));
  await tv.start();
  const code = (tv.getState() as Extract<TvSessionState, { kind: 'waiting' }>).code;
  return { hub, tv, code, calls, graphs, states };
}

describe('TV ⇄ phone session', () => {
  it('pairs only after TV approval, then dispatches sequenced commands', async () => {
    const { hub, tv, code, calls } = await startPair();
    const phone = new ControllerSession(hub.transport(), 'iphone');
    await phone.connect(code.toLowerCase().replace(/(.{5})/, '$1-'));
    await settle(5);
    expect(tv.getState()).toMatchObject({ kind: 'pending', device: 'iphone' });
    expect(phone.getState().kind).toBe('awaiting-approval');
    // Commands before approval are ignored.
    expect(phone.send({ t: 'reset' })).toBe(false);
    tv.approve();
    await settle();
    expect(phone.getState().kind).toBe('connected');
    phone.send({ t: 'orbit', az: 0.25, pol: -0.1 });
    phone.send({ t: 'zoom', factor: 1.2 });
    phone.send({ t: 'select', id: 'n1' });
    phone.send({ t: 'focus', on: true, level: 2 });
    phone.send({ t: 'primaryOnly', on: true });
    phone.send({ t: 'toolbar', visible: true });
    phone.send({ t: 'reset' });
    await settle();
    expect(calls).toEqual(['orbit:0.25,-0.10', 'zoom:1.2', 'select:n1', 'focus:true:2', 'primaryOnly:true', 'toolbar:true', 'reset']);
  });

  it('drops replayed / reordered commands', async () => {
    const { hub, tv, code, calls } = await startPair();
    // Connect manually so we can inject raw frames.
    const ch = await hub.transport().connect(await peerIdForCode(code));
    ch.onMessage(async (m: any) => {
      if (m.t === 'challenge') ch.send({ t: 'auth', proof: await computeProof(code, m.nonce, ch.localId) });
    });
    ch.send({ t: 'hello', v: 1, device: 'other' });
    await settle(5);
    tv.approve();
    await settle();
    ch.send({ t: 'reset', seq: 1 });
    ch.send({ t: 'reset', seq: 1 }); // replay
    ch.send({ t: 'zoom', factor: 2, seq: 0 }); // older
    ch.send({ t: 'zoom', factor: 2, seq: 2 });
    await settle();
    expect(calls).toEqual(['reset', 'zoom:2']);
  });

  it('rejects a wrong code and rotates after repeated bad proofs', async () => {
    const { hub, tv, code } = await startPair();
    // A different code maps to a different peer id: the TV simply isn't found.
    const phone = new ControllerSession(hub.transport(), 'android');
    const other = code === 'AAAAAAAAAA' ? 'BBBBBBBBBB' : 'AAAAAAAAAA';
    await phone.connect(other);
    expect(phone.getState()).toEqual({ kind: 'failed', reason: 'not-found' });
    // Someone who learns the peer id but not the code fails the proof.
    const id = await peerIdForCode(code);
    for (let i = 0; i < 5; i++) {
      const ch = await hub.transport().connect(id).catch(() => null);
      if (!ch) break;
      const replies: any[] = [];
      ch.onMessage((m) => replies.push(m));
      ch.send({ t: 'hello', v: 1, device: 'other' });
      await settle(2);
      ch.send({ t: 'auth', proof: 'f'.repeat(64) });
      await settle(90);
      expect(replies.some((r) => r.t === 'auth-fail' && r.reason === 'bad-proof')).toBe(true);
    }
    await settle(90);
    const now = tv.getState() as Extract<TvSessionState, { kind: 'waiting' }>;
    expect(now.kind).toBe('waiting');
    expect(now.code).not.toBe(code); // rotated after MAX_AUTH_FAILURES
  });

  it('owner rejection fails the phone and rotates the code', async () => {
    const { hub, tv, code } = await startPair();
    const phone = new ControllerSession(hub.transport(), 'iphone');
    await phone.connect(code);
    await settle(5);
    tv.reject();
    await settle(100);
    expect(phone.getState()).toEqual({ kind: 'failed', reason: 'rejected' });
    expect((tv.getState() as { code?: string }).code).not.toBe(code);
  });

  it('answers busy to a second device while one is pending', async () => {
    const { hub, code } = await startPair();
    const a = new ControllerSession(hub.transport(), 'iphone');
    await a.connect(code);
    await settle(5);
    const b = new ControllerSession(hub.transport(), 'android');
    await b.connect(code);
    await settle(5);
    expect(b.getState()).toEqual({ kind: 'failed', reason: 'busy' });
    expect(a.getState().kind).toBe('awaiting-approval');
  });

  it('expires unused codes', async () => {
    const { hub, tv, code } = await startPair(250);
    await settle(400);
    const s = tv.getState() as { kind: string; code?: string };
    expect(s.kind).toBe('waiting');
    expect(s.code).not.toBe(code);
    const phone = new ControllerSession(hub.transport(), 'iphone');
    await phone.connect(code);
    expect(phone.getState()).toEqual({ kind: 'failed', reason: 'not-found' });
  });

  it('shares the phone graph temporarily and clears it on disconnect', async () => {
    const { hub, tv, code, graphs } = await startPair();
    const phone = new ControllerSession(hub.transport(), 'iphone');
    await phone.connect(code);
    await settle(5);
    tv.approve();
    await settle();
    const sample = buildSampleSnapshot();
    expect(phone.shareGraph(sample)).toBe(true);
    await settle();
    expect(graphs.at(-1)!.nodes.size).toBe(sample.nodes.size);
    phone.disconnect();
    await settle(150);
    expect(graphs.at(-1)).toBeNull(); // temporary data discarded
    expect(tv.getState().kind).toBe('waiting'); // fresh code for the next pairing
    expect((tv.getState() as { code: string }).code).not.toBe(code);
  });

  it('stop() ends the phone session and clears data', async () => {
    const { hub, tv, code, graphs } = await startPair();
    const phone = new ControllerSession(hub.transport(), 'iphone');
    await phone.connect(code);
    await settle(5);
    tv.approve();
    await settle();
    phone.shareGraph(buildSampleSnapshot());
    await settle();
    tv.stop();
    await settle(150);
    expect(graphs.at(-1)).toBeNull();
    expect(phone.getState()).toEqual({ kind: 'ended', reason: 'exit' });
    expect(tv.getState().kind).toBe('idle');
  });
});
