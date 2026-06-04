import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../../src/app.js';
import { createDefaultEnv } from '../../src/config/env.js';
import { createMetrics } from '../../src/infra/metrics/index.js';
import { MemoryProcessedUpdatesStore } from '../../src/infra/telegram/processedUpdatesStore.js';
import { InMemoryAccessStore } from '../../src/modules/access/demoStore.js';
import {
  AccessCurrentQrService,
  ScaffoldCurrentQrService
} from '../../src/modules/qr/service.js';
import { QrTokenService } from '../../src/modules/qr/tokenService.js';
import {
  PolicyAccessScannerService,
  ScaffoldAccessScannerService
} from '../../src/modules/scanner/service.js';

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

async function createAccessApp() {
  const env = createDefaultEnv({
    NODE_ENV: 'test',
    TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test-secret',
    QR_SIGNING_SECRET: 'test-only-qr-signing-secret-with-32chars'
  });
  const store = new InMemoryAccessStore({ databasePath: ':memory:' });
  const tokenService = new QrTokenService(env);
  const app = await buildApp({
    env,
    metrics: createMetrics(),
    processedUpdatesStore: new MemoryProcessedUpdatesStore(),
    accessStore: store,
    qrTokenService: tokenService,
    currentQrService: new AccessCurrentQrService(store, tokenService),
    accessScannerService: new PolicyAccessScannerService(store, tokenService),
    resolveActorSubject: (identity) =>
      store.findSubjectByTelegramIdentity(
        identity.telegramUserId,
        identity.telegramUsername
      ),
    listAccessEvents: (limit) => store.listAccessEvents(limit),
    telegramUpdateHandler: async () => {}
  });

  return {
    app,
    store
  };
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
    display_message: 'Сканер работает, но проверка ещё не настроена'
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

test('Web App registration creates a pending request that admin can approve', async (t) => {
  const { app } = await createAccessApp();

  t.after(async () => {
    await app.close();
  });

  const registration = await app.inject({
    method: 'POST',
    url: '/api/v1/registration/request',
    headers: {
      'x-dev-telegram-user-id': '9001',
      'x-dev-telegram-username': 'fresh_user'
    },
    payload: {
      full_name: 'Fresh User',
      requested_role: 'employee',
      consent_accepted: true,
      photo_data_url: 'data:image/png;base64,AA=='
    }
  });

  assert.equal(registration.statusCode, 200);
  assert.equal(registration.json().request.status, 'pending');

  const requests = await app.inject({
    method: 'GET',
    url: '/api/v1/registration/requests',
    headers: {
      'x-dev-telegram-user-id': '1',
      'x-dev-telegram-username': 'Light_epoH'
    }
  });
  const requestId = requests.json().requests[0].id;

  assert.equal(requests.statusCode, 200);

  const approval = await app.inject({
    method: 'POST',
    url: `/api/v1/registration/requests/${requestId}/approve`,
    headers: {
      'x-dev-telegram-user-id': '1',
      'x-dev-telegram-username': 'Light_epoH'
    }
  });

  assert.equal(approval.statusCode, 200);
  assert.equal(approval.json().subject.kind, 'employee');

  const state = await app.inject({
    method: 'GET',
    url: '/api/v1/app/state',
    headers: {
      'x-dev-telegram-user-id': '9001',
      'x-dev-telegram-username': 'fresh_user'
    }
  });

  assert.equal(state.statusCode, 200);
  assert.equal(state.json().subject.full_name, 'Fresh User');
  assert.ok(state.json().tabs.includes('qr'));
});

test('guard sees scanner tab but cannot open admin audit', async (t) => {
  const { app, store } = await createAccessApp();
  store.addOrUpdateUser({
    username: 'arineyvert',
    kind: 'guard',
    fullName: '@arineyvert'
  });

  t.after(async () => {
    await app.close();
  });

  const state = await app.inject({
    method: 'GET',
    url: '/api/v1/app/state',
    headers: {
      'x-dev-telegram-user-id': '44',
      'x-dev-telegram-username': 'arineyvert'
    }
  });
  const audit = await app.inject({
    method: 'GET',
    url: '/api/v1/access/events',
    headers: {
      'x-dev-telegram-user-id': '44',
      'x-dev-telegram-username': 'arineyvert'
    }
  });

  assert.equal(state.statusCode, 200);
  assert.equal(state.json().subject.kind, 'guard');
  assert.equal(state.json().permissions.can_scan, true);
  assert.equal(state.json().permissions.can_view_audit, false);
  assert.ok(state.json().tabs.includes('scanner'));
  assert.equal(state.json().tabs.includes('audit'), false);
  assert.equal(audit.statusCode, 403);
});
