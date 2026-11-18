import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import nodeHandler from '../api/v1/[...route].js';

it('serves the Node deployment entry point locally without granting access or contacting a provider', async () => {
  const server = createServer(nodeHandler).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/api/v1`;
    const me = await fetch(base + '/me');
    assert.equal(me.status, 401);
    assert.equal((await me.json()).error.code, 'authentication_required');
    const webhook = await fetch(base + '/webhooks/payments', { method: 'POST', body: 'synthetic' });
    assert.equal(webhook.status, 503);
    assert.equal((await webhook.json()).error.code, 'integration_disabled');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
