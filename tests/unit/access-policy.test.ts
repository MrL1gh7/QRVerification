import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultEnv } from '../../src/config/env.js';
import { InMemoryAccessStore } from '../../src/modules/access/demoStore.js';
import { AccessCurrentQrService } from '../../src/modules/qr/service.js';
import { QrTokenService } from '../../src/modules/qr/tokenService.js';
import { PolicyAccessScannerService } from '../../src/modules/scanner/service.js';

function createServices() {
  const env = createDefaultEnv({
    NODE_ENV: 'test',
    QR_SIGNING_SECRET: 'test-only-qr-signing-secret-with-32chars'
  });
  const store = new InMemoryAccessStore();
  const tokenService = new QrTokenService(env);

  return {
    store,
    qr: new AccessCurrentQrService(store, tokenService),
    scanner: new PolicyAccessScannerService(store, tokenService)
  };
}

test('employee cannot access a floor outside the access profile', async () => {
  const { qr, scanner } = createServices();
  const current = await qr.getCurrent({
    requestedSubjectId: 'demo_employee_f3'
  });

  assert.ok(current.qr_token);

  const result = await scanner.scan(
    {
      request_id: 'req_floor_denied',
      scanner_id: 'scn_lift_f2',
      captured_at: '2026-04-23T10:52:03Z',
      token: current.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );

  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'floor_not_allowed');
});

test('visitor pass moves from enter to move to exit', async () => {
  const { qr, scanner } = createServices();

  const enterQr = await qr.getCurrent({
    requestedSubjectId: 'demo_visitor'
  });
  assert.ok(enterQr.qr_token);

  const enter = await scanner.scan(
    {
      request_id: 'req_visitor_enter',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-04-23T10:52:03Z',
      token: enterQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  assert.equal(enter.decision, 'allow');
  assert.equal(enter.next_subject_state, 'entered');

  const moveQr = await qr.getCurrent({
    requestedSubjectId: 'demo_visitor'
  });
  assert.ok(moveQr.qr_token);

  const move = await scanner.scan(
    {
      request_id: 'req_visitor_move',
      scanner_id: 'scn_lift_f3',
      captured_at: '2026-04-23T10:52:10Z',
      token: moveQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  assert.equal(move.decision, 'allow');
  assert.equal(move.direction, 'move');

  const exitQr = await qr.getCurrent({
    requestedSubjectId: 'demo_visitor'
  });
  assert.ok(exitQr.qr_token);

  const exit = await scanner.scan(
    {
      request_id: 'req_visitor_exit',
      scanner_id: 'scn_exit',
      captured_at: '2026-04-23T10:53:00Z',
      token: exitQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  assert.equal(exit.decision, 'allow');
  assert.equal(exit.next_subject_state, 'exited');
});
