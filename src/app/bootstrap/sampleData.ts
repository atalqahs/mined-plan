import type { GraphSnapshot, MindEdge, MindNode, MindReminder } from '@/domain/entities/types';
import { computeFullLayout } from '@/domain/graph/layout';
import { localTimezone } from '@/domain/reminders/zonedTime';
import { createId } from '@/shared/utils/id';

type Tree = [title: string, category: string, description: string, children?: Tree[]];

/** A realistic starter network in Arabic, used by the "explore a sample" action. */
const SAMPLE: Tree[] = [
  ['العمل', 'عمل', 'المسؤوليات المهنية وما يتفرع عنها.', [
    ['إطلاق المنصة الجديدة', 'عمل', 'الموعد المستهدف نهاية الربع.', [
      ['خطة الإطلاق', 'عمل', ''],
      ['اختبارات المستخدمين', 'عمل', 'خمس جلسات مع عملاء حاليين.'],
      ['الحملة التعريفية', 'عمل', ''],
    ]],
    ['تقييم أداء الفريق', 'عمل', ''],
    ['اجتماع المجلس الشهري', 'عمل', 'تجهيز ملخص الأرقام قبل الاجتماع بيومين.'],
  ]],
  ['الصحة', 'صحة', '', [
    ['برنامج التمارين', 'صحة', 'ثلاث حصص قوة أسبوعيًا.', [['الجري الصباحي', 'صحة', ''], ['تمارين المرونة', 'صحة', '']]],
    ['النوم المنتظم', 'صحة', 'الهدف: سبع ساعات ونصف.'],
    ['الفحص الدوري', 'صحة', ''],
  ]],
  ['التعلّم', 'تعلّم', '', [
    ['قراءة كتاب شهريًا', 'تعلّم', '', [['التفكير السريع والبطيء', 'تعلّم', ''], ['فن الحرب', 'تعلّم', '']]],
    ['دورة تعلّم الآلة', 'تعلّم', 'الوحدة الرابعة: الشبكات العصبية.'],
    ['اللغة اليابانية', 'تعلّم', ''],
  ]],
  ['المال', 'مال', '', [
    ['ميزانية الأسرة', 'مال', ''],
    ['محفظة الاستثمار', 'مال', 'مراجعة التوزيع كل ستة أشهر.'],
    ['صندوق الطوارئ', 'مال', ''],
  ]],
  ['الأسرة', 'أسرة', '', [
    ['رحلة الصيف', 'أسرة', 'خيارات: الأندلس أو اليابان.', [['حجز الطيران', 'أسرة', ''], ['جدول الرحلة', 'أسرة', '']]],
    ['دراسة الأبناء', 'أسرة', ''],
  ]],
  ['أفكار حرة', 'إبداع', 'مساحة لما لم يتخذ شكله بعد.', [
    ['كتاب عن القيادة الهادئة', 'إبداع', ''],
    ['تطبيق لإدارة الوقت', 'إبداع', ''],
  ]],
];

const LINKS: Array<[string, string, string]> = [
  ['دورة تعلّم الآلة', 'إطلاق المنصة الجديدة', 'يغذّي'],
  ['الجري الصباحي', 'النوم المنتظم', 'يدعم'],
  ['محفظة الاستثمار', 'رحلة الصيف', 'يموّل'],
  ['اللغة اليابانية', 'رحلة الصيف', 'تحضير'],
  ['كتاب عن القيادة الهادئة', 'تقييم أداء الفريق', 'مستوحى من'],
  ['تطبيق لإدارة الوقت', 'قراءة كتاب شهريًا', ''],
];

export function buildSampleSnapshot(now = new Date()): GraphSnapshot {
  const nodes = new Map<string, MindNode>();
  const byTitle = new Map<string, string>();
  let tick = 0;
  const walk = (tree: Tree, parentId: string | null) => {
    const [title, category, description, children] = tree;
    const id = createId();
    const at = new Date(now.getTime() - 86_400_000 + tick++ * 1000).toISOString();
    nodes.set(id, { id, title, description, category, parentId, position: [0, 0, 0], status: 'active', deadline: null, createdAt: at, updatedAt: at });
    byTitle.set(title, id);
    children?.forEach((c) => walk(c, id));
  };
  SAMPLE.forEach((t) => walk(t, null));
  const edges = new Map<string, MindEdge>();
  for (const [a, b, rel] of LINKS) {
    const id = createId();
    edges.set(id, { id, sourceNodeId: byTitle.get(a)!, targetNodeId: byTitle.get(b)!, relationType: rel, createdAt: now.toISOString() });
  }
  const tz = localTimezone();
  const reminders = new Map<string, MindReminder>();
  const addReminder = (title: string, offsetH: number, repeatRule?: MindReminder['repeatRule']) => {
    const id = createId();
    reminders.set(id, { id, nodeId: byTitle.get(title)!, dueAt: new Date(now.getTime() + offsetH * 3_600_000).toISOString(), timezone: tz, repeatRule, completed: false, completedAt: null, notificationState: 'pending' });
  };
  addReminder('اجتماع المجلس الشهري', 26, 'monthly');
  addReminder('حجز الطيران', 3);
  addReminder('الجري الصباحي', 14, 'daily');
  const launch = byTitle.get('إطلاق المنصة الجديدة')!;
  nodes.set(launch, { ...nodes.get(launch)!, deadline: new Date(now.getTime() + 21 * 86_400_000).toISOString() });

  const snapshot = { nodes, edges, reminders };
  for (const [id, pos] of computeFullLayout(snapshot)) nodes.set(id, { ...nodes.get(id)!, position: pos });
  return snapshot;
}

/** Synthetic graph for performance measurement (?bench=N). Deterministic. */
export function buildBenchSnapshot(count: number): GraphSnapshot {
  let s = 42;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const nodes = new Map<string, MindNode>();
  const ids: string[] = [];
  const depthOf = new Map<string, number>();
  const primaries = Math.max(6, Math.min(36, Math.round(count / 25)));
  const at = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const id = `bench-${i}`;
    let parentId: string | null = null;
    if (i >= primaries) {
      // Prefer shallow parents so trees stay broad (depth ≤ 4).
      for (let tries = 0; tries < 8; tries++) {
        const cand = ids[Math.floor(rnd() * ids.length)];
        if ((depthOf.get(cand) ?? 0) < 3) {
          parentId = cand;
          break;
        }
      }
      parentId ??= ids[Math.floor(rnd() * primaries)];
    }
    depthOf.set(id, parentId ? (depthOf.get(parentId) ?? 0) + 1 : 0);
    const ts = new Date(at.getTime() + i * 1000).toISOString();
    nodes.set(id, { id, title: `فكرة رقم ${i + 1}`, description: '', category: `فئة ${(i % 7) + 1}`, parentId, position: [0, 0, 0], status: 'active', deadline: null, createdAt: ts, updatedAt: ts });
    ids.push(id);
  }
  const edges = new Map<string, MindEdge>();
  const seen = new Set<string>();
  for (let i = 0; i < Math.round(count * 0.12); i++) {
    const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)];
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || seen.has(k)) continue;
    seen.add(k);
    edges.set(`be-${i}`, { id: `be-${i}`, sourceNodeId: a, targetNodeId: b, relationType: '', createdAt: at.toISOString() });
  }
  const snapshot = { nodes, edges, reminders: new Map() };
  for (const [id, pos] of computeFullLayout(snapshot)) nodes.set(id, { ...nodes.get(id)!, position: pos });
  return snapshot;
}
