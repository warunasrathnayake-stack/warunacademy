import { identity } from './modules/identity.js';
import { admissions } from './modules/admissions.js';
import { attendance } from './modules/attendance.js';
import { learning } from './modules/learning.js';
import { crm } from './modules/crm.js';
import { editorial } from './modules/editorial.js';
import { provisioning } from './modules/provisioning.js';
export const routes = [
  ...identity,
  ...provisioning,
  ...admissions,
  ...attendance,
  ...learning,
  ...crm,
  ...editorial,
];
