import { z } from 'zod';
import { id, text, phone, day, page, idResult, type Contract } from '../platform/contract.js';
const admission = z
  .strictObject({
    request_id: id,
    student_name: text,
    birth_date: day,
    group_id: id,
    guardian_id: id.nullable().default(null),
    guardian_name: text.nullable().default(null),
    guardian_phone: phone.nullable().default(null),
    relationship: text,
    consent: z.literal(true),
    notice_version: text,
    evidence_ref: text,
  })
  .refine(
    (v) =>
      v.guardian_id
        ? v.guardian_name === null && v.guardian_phone === null
        : v.guardian_name !== null && v.guardian_phone !== null,
    'Provide either an existing guardian_id or a new guardian name and E.164 phone, never both.',
  );
export const admissions: Contract[] = [
  {
    method: 'POST',
    path: '/admissions',
    rpc: 'admit',
    summary:
      'Admit with an existing guardian ID or a new guardian name + phone, consent evidence and class',
    access: 'admit',
    body: admission,
    status: 201,
    result: z.object({
      registration_id: id,
      student_id: id,
      student_code: z.string(),
      guardian_id: id,
      enrollment_id: id,
    }),
  },
  {
    method: 'GET',
    path: '/students',
    rpc: 'students',
    summary: 'Read scoped student roster (no birth dates or contact details)',
    access: 'family / scoped teacher / admissions / card issuer',
    query: page,
    result: z.array(
      z.object({
        id,
        student_code: z.string(),
        name: z.string(),
        grade_id: id,
        active: z.boolean(),
      }),
    ),
  },
  {
    method: 'GET',
    path: '/students/{student_id}/guardians',
    params: { student_id: id },
    rpc: 'guardians',
    summary: 'Read authorized guardian links and contact details',
    access: 'admit or verified linked guardian (self only)',
    result: z.array(
      z.object({ id, name: z.string(), phone: z.string(), relationship: z.string() }),
    ),
  },
  {
    method: 'GET',
    path: '/students/{student_id}/enrollments',
    params: { student_id: id },
    rpc: 'enrollments',
    summary: 'Read student class enrolments',
    access: 'family / admissions / scoped academic staff',
    result: z.array(z.object({ id, group_id: id, starts_on: day, ends_on: day.nullable() })),
  },
  {
    method: 'POST',
    path: '/enrollments',
    rpc: 'enroll',
    summary: 'Enroll a consented student in an additional active class of their grade',
    access: 'admit',
    body: z.strictObject({ student_id: id, group_id: id }),
    status: 201,
    result: idResult,
  },
  {
    method: 'POST',
    path: '/guardian/consent',
    rpc: 'record_consent',
    summary: 'Append a grant or withdrawal with notice and evidence references',
    access: 'guardian role + verified family link',
    body: z.strictObject({
      student_id: id,
      purpose: z.enum(['admission', 'attendance_notice', 'recording', 'marketing']),
      granted: z.boolean(),
      notice_version: text,
      evidence_ref: text,
    }),
    status: 201,
    result: idResult,
  },
];
