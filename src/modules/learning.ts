import { z } from 'zod';
import { id, page, time, type Contract } from '../platform/contract.js';
export const learning: Contract[] = [
  {
    method: 'GET',
    path: '/classes',
    rpc: 'classes',
    summary: 'List visible active classes, courses and grades',
    access: 'class scope',
    query: page,
    result: z.array(
      z.object({ id, label: z.string(), course_title: z.string(), grade: z.number() }),
    ),
  },
  {
    method: 'GET',
    path: '/classes/{group_id}/sessions',
    rpc: 'sessions',
    summary: 'Class schedule including cancellations',
    access: 'class scope',
    params: { group_id: id },
    query: page,
    result: z.array(z.object({ id, starts_at: time, ends_at: time, cancelled: z.boolean() })),
  },
  {
    method: 'GET',
    path: '/resources',
    rpc: 'resources',
    summary: 'List entitled, cleared library resources',
    access: 'entitled family or library.manage',
    query: page,
    result: z.array(z.object({ id, title: z.string(), grade_id: id.nullable() })),
  },
  {
    method: 'GET',
    path: '/resources/{resource_id}/access',
    special: 'resource',
    rpc: 'resource_access',
    summary: 'Request a 60-second signed URL using the user JWT and Storage RLS',
    access: 'entitled family or library.manage',
    params: { resource_id: id },
    result: z.object({ url: z.url(), expires_in: z.literal(60) }),
  },
];
