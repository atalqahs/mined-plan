import { z } from 'zod';
import type { MindEdge, MindNode, MindReminder } from '@/domain/entities/types';

/** Runtime validation for anything crossing a trust boundary (IndexedDB, imported files). */
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date');
const finite = z.number().finite();

export const nodeSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(20_000).default(''),
  parentId: z.string().min(1).nullable().default(null),
  category: z.string().max(40).default(''),
  position: z.tuple([finite, finite, finite]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  deadline: iso.nullable().optional(),
  createdAt: iso,
  updatedAt: iso,
});

export const edgeSchema = z.object({
  id: z.string().min(1).max(128),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  relationType: z.string().max(40).default(''),
  createdAt: iso,
});

export const reminderSchema = z.object({
  id: z.string().min(1).max(128),
  nodeId: z.string().min(1),
  dueAt: iso,
  timezone: z.string().min(1).max(64),
  repeatRule: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  completed: z.boolean(),
  completedAt: iso.nullable().optional(),
  notificationState: z.enum(['pending', 'notified', 'missed']).catch('pending'),
  note: z.string().max(200).optional(),
});

export function parseNode(raw: unknown) {
  return nodeSchema.safeParse(raw) as z.ZodSafeParseResult<MindNode>;
}
export function parseEdge(raw: unknown) {
  return edgeSchema.safeParse(raw) as z.ZodSafeParseResult<MindEdge>;
}
export function parseReminder(raw: unknown) {
  return reminderSchema.safeParse(raw) as z.ZodSafeParseResult<MindReminder>;
}

export function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
