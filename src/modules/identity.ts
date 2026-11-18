import { z } from 'zod';
import { id, type Contract } from '../platform/contract.js';
export const identity: Contract[] = [
  {
    method: 'GET',
    path: '/me',
    rpc: 'me',
    summary: 'My verified account profile and assigned roles',
    access: 'self',
    result: z.object({
      id,
      display_name: z.string().nullable(),
      locale: z.string(),
      roles: z.array(z.string()),
    }),
  },
  {
    method: 'POST',
    path: '/auth/logout',
    special: 'logout',
    summary: 'Revoke refresh for the current Supabase session',
    access: 'self',
    result: z.object({ signed_out: z.literal(true) }),
  },
];
