/**
 * Realistic Arabic graph fixture matching a reported production network:
 * 69 nodes, 18 cross-links, Arabic titles/categories (multi-byte UTF-8).
 * Deterministic. Positions follow the current layout keep-out (outside radius 10.2).
 */
const PRIMARIES = ['إدارة شخصية', 'إدارة العقارات', 'الاستثمارات', 'المشاريع', 'العائلة', 'الصحة واللياقة', 'التعلم والتطوير', 'الأفكار الإبداعية'];
const WORDS = ['ترتيب', 'داخلي', 'وخارجي', 'إدارة', 'المستودعات', 'عقارات', 'تركيا', 'خطة', 'مراجعة', 'الميزانية', 'الشهرية', 'متابعة', 'العقود', 'الإيجار', 'صيانة', 'المبنى', 'تطوير', 'المحفظة', 'الأسهم', 'السندات', 'التقارير', 'الربعية', 'السفر', 'تعليم', 'الأبناء', 'الاجتماعات', 'الأسبوعية', 'القراءة', 'كتاب', 'دورة', 'تدريبية', 'تصميم', 'نموذج', 'أولي', 'إطلاق', 'المنصة'];

export function arabicGraphBackup(nodeCount = 69, edgeCount = 18) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
  const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
  const nodes: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nodeCount; i++) {
    const primary = i < PRIMARIES.length;
    const parent = primary ? null : `node-${Math.floor(rnd() * Math.min(i, 30))}`;
    const words = 5 + Math.floor(rnd() * 5);
    const title = primary ? PRIMARIES[i] : Array.from({ length: words }, pick).join(' ');
    const r = primary ? 12.6 : 14 + rnd() * 5;
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    nodes.push({
      id: `node-${i}`,
      title,
      description: `ملاحظات خاصة جدًا رقم ${i}: لا يجب أن تغادر الهاتف.`,
      parentId: parent,
      category: ['عمل', 'أسرة', 'مال', 'صحة', 'تعلّم'][i % 5],
      position: [+(r * Math.sin(ph) * Math.cos(th)).toFixed(3), +(r * Math.cos(ph) * 0.8).toFixed(3), +(r * Math.sin(ph) * Math.sin(th)).toFixed(3)],
      ...(i % 3 === 0 ? { color: ['#A4AAB0', '#8C9A8F', '#9C7F7C', '#8E8A9E'][i % 4] } : {}),
      status: i % 11 === 0 ? 'completed' : 'active',
      deadline: null,
      createdAt: at(i),
      updatedAt: at(i),
    });
  }
  const edges: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  while (edges.length < edgeCount) {
    const a = Math.floor(rnd() * nodeCount), b = Math.floor(rnd() * nodeCount);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || seen.has(k)) continue;
    seen.add(k);
    edges.push({ id: `edge-${edges.length}`, sourceNodeId: `node-${a}`, targetNodeId: `node-${b}`, relationType: 'مرتبط بـ', createdAt: at(0) });
  }
  return { app: 'orbital-mind', schemaVersion: 2, exportedAt: at(0), nodes, edges, reminders: [] };
}
