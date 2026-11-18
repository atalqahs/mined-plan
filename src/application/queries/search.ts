import type { GraphSnapshot, MindNode } from '@/domain/entities/types';
import { normalizeArabic } from '@/shared/utils/arabic';

export interface SearchHit {
  node: MindNode;
  score: number;
  /** Where the match was found. */
  field: 'title' | 'category' | 'description';
}

/**
 * Arabic-aware ranked search over titles, categories and notes.
 * Title prefix > title word-prefix > title substring > category > description.
 */
export function searchNodes(snapshot: GraphSnapshot, rawQuery: string, limit = 12): SearchHit[] {
  const q = normalizeArabic(rawQuery);
  if (!q) return [];
  const terms = q.split(' ');
  const hits: SearchHit[] = [];
  for (const node of snapshot.nodes.values()) {
    const title = normalizeArabic(node.title);
    let score = 0;
    let field: SearchHit['field'] = 'title';
    if (title.startsWith(q)) score = 100;
    else if (title.split(' ').some((w) => w.startsWith(q))) score = 80;
    else if (title.includes(q)) score = 60;
    else if (terms.every((t) => title.includes(t))) score = 50;
    else {
      const cat = normalizeArabic(node.category);
      if (cat && terms.every((t) => cat.includes(t))) {
        score = 35;
        field = 'category';
      } else {
        const desc = normalizeArabic(node.description);
        if (desc && terms.every((t) => desc.includes(t))) {
          score = 20;
          field = 'description';
        }
      }
    }
    if (!score) continue;
    if (node.status === 'archived') score -= 5;
    hits.push({ node, score: score - Math.min(title.length, 60) / 100, field });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
