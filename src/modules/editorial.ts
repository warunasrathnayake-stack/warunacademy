import { z } from 'zod';
import { id, text, time, page, idResult, type Contract } from '../platform/contract.js';
export const editorial: Contract[] = [
  {
    method: 'GET',
    path: '/posts',
    rpc: 'posts',
    summary: 'Published content for members; editorial staff also see drafts',
    access: 'member / content.manage',
    query: page,
    result: z.array(
      z.object({ id, slug: z.string(), title: z.string(), body: z.string(), status: z.string() }),
    ),
  },
  {
    method: 'POST',
    path: '/admin/posts',
    rpc: 'draft_post',
    summary: 'Create an unpublished post and its first revision',
    access: 'content.manage',
    body: z.strictObject({
      slug: z
        .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .max(120),
      title: text,
      body: z.string().min(1).max(12000),
    }),
    status: 201,
    result: idResult,
  },
  {
    method: 'GET',
    path: '/notifications',
    rpc: 'notifications',
    summary: 'Read my in-app notifications; no external delivery',
    access: 'self',
    query: page,
    result: z.array(
      z.object({ id, title: z.string(), read_at: time.nullable(), created_at: time }),
    ),
  },
];
