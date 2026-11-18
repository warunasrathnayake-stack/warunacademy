import { z } from 'zod';
import {
  id,
  text,
  phone,
  time,
  page,
  stages,
  idResult,
  type Contract,
} from '../platform/contract.js';
export const crm: Contract[] = [
  {
    method: 'GET',
    path: '/admin/leads',
    rpc: 'leads',
    summary: 'List consent-evidenced CRM leads',
    access: 'crm.manage',
    query: page,
    result: z.array(
      z.object({ id, name: z.string(), phone: z.string(), stage: stages, created_at: time }),
    ),
  },
  {
    method: 'POST',
    path: '/admin/leads',
    rpc: 'create_lead',
    summary: 'Create a contact, lead and source attribution; no messaging',
    access: 'crm.manage',
    body: z.strictObject({ name: text, phone, consent_ref: text, source: text }),
    status: 201,
    result: idResult,
  },
  {
    method: 'PATCH',
    path: '/admin/leads/{lead_id}',
    rpc: 'update_lead',
    summary: 'Change stage and record a follow-up activity',
    access: 'crm.manage',
    params: { lead_id: id },
    body: z.strictObject({
      stage: stages,
      note: z.string().max(400).nullable().default(null),
      follow_up_at: time.nullable().default(null),
    }),
    result: idResult,
  },
];
