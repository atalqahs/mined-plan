import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, computeProof, describeDevice, generatePairingCode, normalizePairingCode, peerIdForCode, SequenceGuard, verifyProof } from '@/application/remote/pairing';
import { parseCommand, parseTvMessage } from '@/application/remote/protocol';
import { buildGraphParts, fromSharedGraph, GraphReceiver, PART_FRAME_BYTES, toSharedGraph } from '@/application/remote/graphShare';
import { RemoteDiagnostics } from '@/application/remote/diagnostics';
import { JsonBackupCodec } from '@/infrastructure/backup/jsonBackupCodec';
import { arabicGraphBackup } from '../fixtures/arabicGraph';
import { TvSession, type TvCommandSink, type TvSessionState } from '@/application/remote/tvSession';
import { ControllerSession } from '@/application/remote/controllerSession';
import { buildBenchSnapshot, buildSampleSnapshot } from '@/app/bootstrap/sampleData';
import type { GraphSnapshot } from '@/domain/entities/types';
import { MemoryHub, settle, type HubOptions } from './memoryTransport';

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
    expect(parseCommand({ t: 'graph-part', gid: 'g', i: 0, nodes: 'x', edges: [], seq: 1 })).toBeNull();
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
    const parts = buildGraphParts(shared);
    expect(parts.length).toBeGreaterThan(1);
    const rx = new GraphReceiver();
    rx.begin('g1', parts.length, shared.nodes.length, shared.edges.length);
    let out: unknown = null;
    [...parts].reverse().forEach((p, k) => {
      const r = rx.add('g1', parts.length - 1 - k, p); // order-independent
      if (r.status === 'complete') out = r.graph;
    });
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
    graph: (g) => void graphs.push(g),
  };
  return { sink, calls, graphs };
}

async function startPair(ttl?: number, hubOpts: HubOptions = {}, tvOpts: Record<string, number> = {}) {
  const hub = new MemoryHub(hubOpts);
  const { sink, calls, graphs } = makeSink();
  const tv = new TvSession(hub.transport(), sink, undefined, { ttlMs: ttl, ...tvOpts });
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
    ch.send({ t: 'hello', v: 2, device: 'other' });
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
      ch.send({ t: 'hello', v: 2, device: 'other' });
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
    phone.shareGraph(sample);
    await settle(20);
    expect(phone.getShareStatus()).toEqual({ status: 'shown', nodes: sample.nodes.size, edges: sample.edges.size });
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
    await settle(20);
    tv.stop();
    await settle(150);
    expect(graphs.at(-1)).toBeNull();
    expect(phone.getState()).toEqual({ kind: 'ended', reason: 'exit' });
    expect(tv.getState().kind).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the production incident (iPhone + Mi TV Stick):
//  Bug 2: "عرض أفكاري" disconnected instantly — the first graph frame was ≥ 16,300 UTF-8 bytes,
//         PeerJS refused it with an error, and the error was treated as a closed channel.
//  Bug 1: the phone dropped after ~1 minute — a non-fatal error (signaling loss) tore the
//         session down, and a transient channel loss was final.
// ---------------------------------------------------------------------------

const arabicSnapshot = (): GraphSnapshot => {
  const r = new JsonBackupCodec().decode(JSON.stringify(arabicGraphBackup(69, 18)));
  if (!r.ok) throw new Error(r.error);
  return r.snapshot;
};

const PEERJS_JSON_LIMIT = 16_300;
const enc = new TextEncoder();

async function connectedPair(hubOpts: HubOptions = { maxFrameBytes: PEERJS_JSON_LIMIT }, tvOpts: Record<string, number> = {}, ctlOpts = {}) {
  const pair = await startPair(undefined, hubOpts, tvOpts);
  const phone = new ControllerSession(pair.hub.transport(), 'iphone', undefined, undefined, ctlOpts);
  await phone.connect(pair.code);
  await settle(5);
  pair.tv.approve();
  await settle();
  expect(phone.getState().kind).toBe('connected');
  return { ...pair, phone };
}

describe('incident regression: large Arabic graph transfer (bug 2)', () => {
  it('the realistic graph exceeded the old single-frame limit', () => {
    const shared = toSharedGraph(arabicSnapshot());
    expect(shared.nodes).toHaveLength(69);
    expect(shared.edges).toHaveLength(18);
    expect(enc.encode(JSON.stringify(shared)).byteLength).toBeGreaterThan(PEERJS_JSON_LIMIT);
  });

  it('splits into byte-bounded frames that survive multi-byte UTF-8', () => {
    const shared = toSharedGraph(arabicSnapshot());
    const parts = buildGraphParts(shared);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p, i) => {
      const frame = JSON.stringify({ t: 'graph-part', gid: 'abcdef0123456789', i, nodes: p.nodes, edges: p.edges, seq: 123456 });
      expect(enc.encode(frame).byteLength).toBeLessThanOrEqual(PART_FRAME_BYTES);
    });
    expect(parts.flatMap((p) => p.nodes)).toEqual(shared.nodes);
    expect(parts.flatMap((p) => p.edges)).toEqual(shared.edges);
  });

  it('shares the real-sized graph, reports success only after the TV validated it, and stays connected', async () => {
    const { tv, phone, graphs, calls, hub } = await connectedPair();
    const statuses: string[] = [];
    phone.onShare((s) => statuses.push(s.status));
    phone.shareGraph(arabicSnapshot());
    expect(phone.getShareStatus().status).toBe('sending');
    await settle(30);
    expect(hub.refused).toBe(0); // no frame hit the PeerJS limit
    expect(graphs.at(-1)!.nodes.size).toBe(69);
    expect(graphs.at(-1)!.edges.size).toBe(18);
    expect(phone.getShareStatus()).toEqual({ status: 'shown', nodes: 69, edges: 18 });
    expect(statuses.indexOf('shown')).toBe(statuses.length - 1);
    // Private notes never reach the TV.
    for (const n of graphs.at(-1)!.nodes.values()) expect(n.description).toBe('');
    // Controls still work during/after sharing.
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected');
    phone.send({ t: 'primaryOnly', on: true });
    phone.send({ t: 'orbit', az: 0.1, pol: 0 });
    await settle();
    expect(calls).toEqual(['primaryOnly:true', 'orbit:0.10,0.00']);
  });

  it('reports "shown" only after the TV has put the graph on screen', async () => {
    const pair = await startPair(undefined, { maxFrameBytes: PEERJS_JSON_LIMIT });
    let applied = false;
    (pair.tv as unknown as { sink: TvCommandSink }).sink.graph = (g) =>
      g ? new Promise<void>((r) => setTimeout(() => ((applied = true), r()), 150)) : undefined;
    const phone = new ControllerSession(pair.hub.transport(), 'iphone');
    await phone.connect(pair.code);
    await settle(5);
    pair.tv.approve();
    await settle();
    phone.shareGraph(arabicSnapshot());
    await settle(50);
    expect(applied).toBe(false);
    expect(phone.getShareStatus().status).toBe('sending');
    await settle(200);
    expect(applied).toBe(true);
    expect(phone.getShareStatus()).toEqual({ status: 'shown', nodes: 69, edges: 18 });
  });

  it('an edit on the phone re-shares without disconnecting', async () => {
    const { phone, graphs, tv } = await connectedPair();
    const snap = arabicSnapshot();
    phone.shareGraph(snap);
    await settle(30);
    const first = [...snap.nodes.values()][10];
    (snap.nodes as Map<string, typeof first>).set(first.id, { ...first, title: 'عنوان معدّل من الهاتف' });
    phone.shareGraph(snap);
    await settle(30);
    expect(graphs.at(-1)!.nodes.get(first.id)!.title).toBe('عنوان معدّل من الهاتف');
    expect(phone.getShareStatus().status).toBe('shown');
    expect(tv.getState().kind).toBe('connected');
  });

  it('a transfer the TV rejects reports a failure and keeps the control session', async () => {
    const { phone, tv, hub, calls } = await connectedPair();
    // Tamper: corrupt every graph-part on the wire so the TV's validation fails.
    const ch = hub.lastPhone();
    const send = ch.send.bind(ch);
    ch.send = (m: any) => send(m?.t === 'graph-part' ? { ...m, nodes: m.nodes.map((n: any) => ({ ...n, position: [0, 0] })) } : m);
    phone.shareGraph(arabicSnapshot());
    await settle(30);
    expect(phone.getShareStatus()).toEqual({ status: 'failed', reason: 'rejected-by-tv' });
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected');
    phone.send({ t: 'reset' });
    await settle();
    expect(calls).toContain('reset');
  });

  it('a transfer that stalls times out with an error instead of false success', async () => {
    const { phone, tv, hub } = await connectedPair(undefined, {}, { stallMs: 200 });
    const ch = hub.lastPhone();
    const send = ch.send.bind(ch);
    ch.send = (m: any) => (m?.t === 'graph-part' ? true : send(m)); // parts vanish silently
    phone.shareGraph(arabicSnapshot());
    await settle(350);
    expect(phone.getShareStatus()).toEqual({ status: 'failed', reason: 'timeout' });
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected');
  });

  it('rejects a transfer announcing more than the limits', () => {
    const rx = new GraphReceiver();
    expect(rx.begin('g', 1, 999_999, 0)).toEqual({ status: 'error', reason: 'too-large' });
    rx.begin('g', 1, 1, 0);
    expect(rx.add('other', 0, { nodes: [], edges: [] })).toEqual({ status: 'error', reason: 'unexpected' });
    expect(rx.add('g', 0, { nodes: [], edges: [] })).toEqual({ status: 'error', reason: 'mismatch' });
  });
});

describe('incident regression: session stability (bug 1)', () => {
  it('stays connected through prolonged control-only use (heartbeat keeps both sides alive)', async () => {
    const { phone, tv, calls } = await connectedPair(undefined, { pingMs: 20, silenceMs: 150 }, { silenceMs: 150 });
    for (let i = 0; i < 10; i++) {
      phone.send({ t: 'orbit', az: 0.01, pol: 0 });
      await settle(60); // 600 ms total = 4× the silence threshold
    }
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected');
    expect(calls.filter((c) => c.startsWith('orbit'))).toHaveLength(10);
  });

  it('resumes after an unexpected channel drop without a new approval, keeping the shared graph', async () => {
    const { phone, tv, hub, graphs, calls } = await connectedPair();
    phone.shareGraph(arabicSnapshot());
    await settle(30);
    const events: string[] = [];
    tv.onEvent((e) => events.push(e.type));
    hub.lastPhone().drop('ice-failed');
    await settle(5);
    expect(tv.getState().kind).toBe('reconnecting');
    expect(phone.getState().kind).toBe('reconnecting');
    expect(graphs.at(-1)).not.toBeNull(); // kept during the grace period
    await settle(700); // first resume attempt after 500 ms
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected'); // no 'pending' — no second approval prompt
    expect(events).toEqual(['phone-lost', 'resumed']);
    phone.send({ t: 'reset' });
    await settle();
    expect(calls.at(-1)).toBe('reset');
  });

  it('a resume needs the code AND the one-time token: a stranger with the code cannot take over', async () => {
    const { phone, tv, hub, code } = await connectedPair();
    phone.disconnect = () => {}; // keep the legit phone quiet
    hub.lastPhone().drop('ice-failed');
    await settle(5);
    const intruder = new ControllerSession(hub.transport(), 'android');
    await intruder.connect(code);
    await settle(10);
    expect(intruder.getState()).toEqual({ kind: 'failed', reason: 'busy' });
    expect(['reconnecting', 'connected']).toContain(tv.getState().kind);
  });

  it('clears temporary TV data when the grace period expires', async () => {
    const { phone, tv, hub, graphs } = await connectedPair(undefined, { graceMs: 100 }, { resumeWindowMs: 50 });
    phone.shareGraph(arabicSnapshot());
    await settle(30);
    // Block resumes: the TV becomes unreachable.
    hub.lastPhone().drop('ice-failed');
    (hub as any).peers.clear();
    await settle(900);
    expect(graphs.at(-1)).toBeNull();
    expect(tv.getState().kind).toBe('waiting'); // fresh code; the old session is gone
    expect(phone.getState()).toEqual({ kind: 'ended', reason: 'lost' });
  });

  it('detects a silently dead link (no close event) on both sides', async () => {
    const { phone, tv, hub } = await connectedPair(undefined, { pingMs: 20, silenceMs: 120, graceMs: 60_000 }, { silenceMs: 120, resumeWindowMs: 60_000 });
    const tvEvents: string[] = [];
    tv.onEvent((e) => tvEvents.push(e.type));
    const phoneStates: string[] = [];
    phone.onState((s) => phoneStates.push(s.kind));
    hub.lastPhone().mute();
    await settle(3000); // controller watchdog checks every 2 s; then it resumes over a fresh channel
    expect(tvEvents.slice(0, 2)).toEqual(['phone-lost', 'resumed']);
    expect(phoneStates).toContain('reconnecting');
    expect(phone.getState().kind).toBe('connected');
    expect(tv.getState().kind).toBe('connected');
    tv.stop();
    phone.disconnect();
  });

  it('explicit disconnect from the phone clears TV data immediately', async () => {
    const { phone, tv, graphs } = await connectedPair();
    phone.shareGraph(arabicSnapshot());
    await settle(30);
    phone.disconnect();
    await settle(150);
    expect(graphs.at(-1)).toBeNull();
    expect(tv.getState().kind).toBe('waiting');
    expect(phone.getState()).toEqual({ kind: 'ended', reason: 'user' });
  });

  it('receives the TV index in pages that each fit the frame budget', async () => {
    const { phone, tv, hub } = await connectedPair();
    const got: number[] = [];
    phone.onIndex((n) => got.push(n.length));
    const nodes = Array.from({ length: 600 }, (_, i) => ({ id: `node-${i}`, title: 'فكرة طويلة جدًا بعنوان عربي متعدد الكلمات '.repeat(2), parentId: null }));
    tv.sendIndex(nodes);
    await settle(10);
    expect(got).toEqual([600]);
    expect(hub.refused).toBe(0);
  });
});

describe('diagnostics privacy', () => {
  it('drops free text, codes, ids and tokens; keeps enum-like facts', () => {
    const d = new RemoteDiagnostics();
    d.log('ice', { role: 'phone', state: 'failed', bytes: 17142.456, ok: true });
    d.log('test', { title: 'فكرة سرية', code: 'ABCDE-FGHJK', peer: 'omtv-0123456789abcdef0123456789abcdef01234567', token: '0123456789abcdef0123456789abcdef', gid: 'a1b2c3d4e5f60718', nested: { x: 1 } as unknown as number });
    d.log('Bad Event Name', { a: 1 });
    const text = d.export({ role: 'phone', ua: 'Mozilla/5.0 (iPhone)' });
    expect(d.list()).toHaveLength(2);
    expect(d.list()[0].data).toEqual({ role: 'phone', state: 'failed', bytes: 17142.46, ok: true });
    expect(d.list()[1].data).toBeUndefined();
    for (const secret of ['فكرة', 'ABCDE', 'omtv', '0123456789abcdef', 'a1b2c3d4', 'Mozilla']) expect(text).not.toContain(secret);
  });
});
