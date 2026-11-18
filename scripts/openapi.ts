import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { routes } from '../src/routes.js';
import { webhookProviders } from '../src/integrations/registry.js';

const paths: Record<string, Record<string, unknown>> = {};
const schema = (s: z.ZodType, io: 'input' | 'output') => {
  const { $schema: _, ...json } = z.toJSONSchema(s, { io });
  return json;
};
for (const r of routes) {
  const parameters = [];
  for (const [where, shape] of [
    ['path', r.params ?? {}],
    ['query', r.query ?? {}],
  ] as const) {
    for (const [name, type] of Object.entries(shape)) {
      const field = type as z.ZodType;
      parameters.push({
        name,
        in: where,
        required: where === 'path' || !field.safeParse(undefined).success,
        schema: schema(field, 'input'),
      });
    }
  }
  (paths[r.path] ??= {})[r.method.toLowerCase()] = {
    operationId: r.rpc ?? r.special,
    summary: r.summary,
    description: `Required access: ${r.access}.`,
    parameters,
    ...(r.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(r.body, 'input') } },
          },
        }
      : {}),
    responses: {
      [r.status ?? 200]: {
        description: 'Success. Private responses are never cached.',
        content: {
          'application/json': {
            schema: schema(z.object({ data: r.result, request_id: z.uuid() }), 'output'),
          },
        },
      },
      default: { $ref: '#/components/responses/Error' },
    },
  };
}
paths['/webhooks/{provider}'] = {
  post: {
    operationId: 'disabledWebhook',
    security: [],
    summary: 'Reserved; refuses all events without acknowledgement or processing',
    parameters: [
      {
        name: 'provider',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: webhookProviders },
      },
    ],
    responses: {
      503: { $ref: '#/components/responses/Error' },
      default: { $ref: '#/components/responses/Error' },
    },
  },
};
const doc = {
  openapi: '3.1.0',
  info: { title: 'academy-core · internal backend', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  security: [{ supabaseBearer: [] }],
  paths,
  components: {
    securitySchemes: {
      supabaseBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'Supabase user JWT' },
    },
    responses: {
      Error: {
        description: 'Sanitized error; request_id can be shared without request data.',
        content: {
          'application/json': {
            schema: schema(
              z.object({ error: z.object({ code: z.string(), request_id: z.uuid() }) }),
              'output',
            ),
          },
        },
      },
    },
  },
};
const path = 'docs/openapi.json';
const rendered = JSON.stringify(doc, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== rendered)
    throw new Error('Stale API contract: run npm run docs:api');
} else await writeFile(path, rendered);
