import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../../src/app.js';
import { createDefaultEnv } from '../../src/config/env.js';
import { createMetrics } from '../../src/infra/metrics/index.js';
import { MemoryProcessedUpdatesStore } from '../../src/infra/telegram/processedUpdatesStore.js';
import { ScaffoldCurrentQrService } from '../../src/modules/qr/service.js';
import { ScaffoldAccessScannerService } from '../../src/modules/scanner/service.js';

async function createTestApp() {
  const env = createDefaultEnv({
    NODE_ENV: 'test',
    TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test-secret'
  });

  return buildApp({
    env,
    metrics: createMetrics(),
    processedUpdatesStore: new MemoryProcessedUpdatesStore(),
    currentQrService: new ScaffoldCurrentQrService(),
    accessScannerService: new ScaffoldAccessScannerService(),
    telegramUpdateHandler: async () => {}
  });
}

test('GET /healthz returns service readiness', async (t) => {
  const app = await createTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/healthz'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'tg-building-access'
  });
});

test('POST /api/v1/access/scan fails closed in scaffold mode', async (t) => {
  const app = await createTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/access/scan',
    payload: {
      request_id: 'req_01',
      scanner_id: 'scn_main_a',
      captured_at: '2026-04-23T10:52:03Z',
      token: 'tgac:v1:header.payload.signature'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    decision: 'deny',
    direction: 'enter',
    reason_code: 'verification_not_configured',
    next_subject_state: 'unknown',
    display_message: 'Scanner scaffold is online, verification is not configured yet'
  });
});

test('POST /webhooks/telegram rejects invalid secret tokens', async (t) => {
  const app = await createTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/telegram',
    payload: {
      update_id: 1
    }
  });

  assert.equal(response.statusCode, 401);
});
