import { z } from 'zod';
export const id = z.uuid();
export const text = z.string().trim().min(1).max(180);
export const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
export const day = z.iso.date();
export const time = z.iso.datetime({ offset: true });
export const page = {
  offset: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,5})$/)
    .default('0'),
};
export const idResult = z.object({ id });
export const states = z.enum(['present', 'late', 'absent', 'excused']);
export const stages = z.enum(['new', 'contacted', 'review', 'converted', 'closed']);
export interface Contract {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  summary: string;
  access: string;
  rpc?: string;
  special?: 'logout' | 'resource';
  params?: z.ZodRawShape;
  query?: z.ZodRawShape;
  body?: z.ZodType;
  result: z.ZodType;
  status?: 201;
}
