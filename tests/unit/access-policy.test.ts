import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDefaultEnv } from '../../src/config/env.js';
import { InMemoryAccessStore } from '../../src/modules/access/demoStore.js';
import type { SubjectKind } from '../../src/modules/access/types.js';
import { AccessCurrentQrService } from '../../src/modules/qr/service.js';
import { QrTokenService } from '../../src/modules/qr/tokenService.js';
import { PolicyAccessScannerService } from '../../src/modules/scanner/service.js';

function createServices() {
  const env = createDefaultEnv({
    NODE_ENV: 'test',
    QR_SIGNING_SECRET: 'test-only-qr-signing-secret-with-32chars'
  });
  const store = new InMemoryAccessStore({ databasePath: ':memory:' });
  const tokenService = new QrTokenService(env);

  return {
    store,
    qr: new AccessCurrentQrService(store, tokenService),
    scanner: new PolicyAccessScannerService(store, tokenService),
    tokenService
  };
}

function addTestUser(
  store: InMemoryAccessStore,
  username: string,
  kind: Exclude<SubjectKind, 'visitor'>
) {
  return store.addOrUpdateUser({
    username,
    kind,
    fullName: `@${username.replace(/^@/, '')}`
  });
}

test('QR is issued only for the permanent admin seed by default', async () => {
  const { qr } = createServices();

  const allowed = await qr.getCurrent({
    telegramUsername: 'Light_epoH'
  });
  const unknown = await qr.getCurrent({
    telegramUsername: 'unknown_user'
  });

  assert.equal(allowed.mode, 'operator');
  assert.ok(allowed.qr_token);
  assert.equal(unknown.qr_token, null);
  assert.equal(unknown.display.status, 'unlinked');
});

test('configured access list exposes only Light_epoH as the permanent user', () => {
  const { store } = createServices();
  const users = store.listSubjects();
  const admins = users.filter((user) => user.kind === 'operator');
  const scanners = users.filter((user) => user.canScan);

  assert.equal(users.length, 1);
  assert.deepEqual(
    admins.map((user) => user.fullName).sort(),
    ['@Light_epoH']
  );
  assert.equal(scanners.length, 1);
  assert.equal(scanners[0]?.telegramUsername, 'light_epoh');
});

test('participants and access logs persist after store restart', () => {
  const databasePath = path.join(mkdtempSync(path.join(tmpdir(), 'qr-access-store-')), 'access.sqlite');
  const firstStore = new InMemoryAccessStore({ databasePath });
  const created = firstStore.addOrUpdateUser({
    username: '@persisted_user',
    kind: 'guard',
    fullName: 'Проверочный пользователь'
  });

  firstStore.appendAccessEvent({
    requestId: 'req_persisted',
    scannerId: 'scn_main_entry',
    accessPointId: 'ap_main_entry',
    accessPointLabel: 'Главный вход',
    subjectId: created.id,
    subjectName: created.fullName,
    subjectKind: created.kind,
    tenantName: created.tenantName,
    direction: 'enter',
    decision: 'allow',
    reasonCode: 'ok',
    displayMessage: 'Доступ разрешён'
  });

  const secondStore = new InMemoryAccessStore({ databasePath });
  const restoredUser = secondStore.findSubjectByTelegramUsername('persisted_user');
  const restoredEvents = secondStore.listAccessEvents(5);

  assert.equal(restoredUser?.kind, 'guard');
  assert.equal(restoredUser?.fullName, 'Проверочный пользователь');
  assert.equal(restoredEvents[0]?.requestId, 'req_persisted');
  assert.equal(restoredEvents[0]?.subjectName, 'Проверочный пользователь');
});

test('admin can add users, change roles, and delete users in the access store', () => {
  const { store } = createServices();

  const created = store.addOrUpdateUser({
    username: '@new_user',
    kind: 'employee',
    fullName: 'New User'
  });
  const updated = store.updateUserRole('@new_user', 'tenant_admin');
  const deleted = store.deleteUser('@new_user');

  assert.equal(created.fullName, 'New User');
  assert.equal(updated?.kind, 'tenant_admin');
  assert.equal(deleted, true);
  assert.equal(store.findSubjectByTelegramUsername('@new_user'), undefined);
});

test('registration request needs admin approval before QR access is issued', async () => {
  const { store, qr } = createServices();
  const request = store.createRegistrationRequest({
    telegramUserId: '999001',
    username: 'new_person',
    fullName: 'Новый Пользователь',
    requestedRole: 'employee',
    consentAccepted: true,
    photoDataUrl: 'data:image/png;base64,AA=='
  });
  const beforeApproval = await qr.getCurrent({
    telegramUserId: '999001',
    telegramUsername: 'new_person'
  });
  const admin = store.findSubjectByTelegramUsername('Light_epoH');

  assert.ok(admin);
  assert.equal(request.status, 'pending');
  assert.equal(beforeApproval.qr_token, null);

  const approved = store.approveRegistrationRequest(request.id, admin);
  const afterApproval = await qr.getCurrent({
    telegramUserId: '999001',
    telegramUsername: 'new_person'
  });

  assert.ok(approved);
  assert.equal(approved.subject.kind, 'employee');
  assert.equal(approved.subject.photoDataUrl, 'data:image/png;base64,AA==');
  assert.ok(afterApproval.qr_token);
});

test('listed user can pass through main entry and exit with fresh QR tokens', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');

  const entryQr = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  assert.ok(entryQr.qr_token);

  const entry = await scanner.scan(
    {
      request_id: 'req_entry_allowed',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-04T10:52:03Z',
      token: entryQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.direction, 'enter');

  const exitQr = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  assert.ok(exitQr.qr_token);

  const exit = await scanner.scan(
    {
      request_id: 'req_exit_allowed',
      scanner_id: 'scn_exit',
      captured_at: '2026-05-04T10:53:03Z',
      token: exitQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  assert.equal(exit.decision, 'allow');
  assert.equal(exit.direction, 'exit');
});

test('non-admin Telegram users cannot use the scanner app', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');

  const current = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  const actor = store.findSubjectByTelegramUsername('ta_pri');

  assert.ok(current.qr_token);
  assert.ok(actor);

  const result = await scanner.scan(
    {
      request_id: 'req_non_admin_scan',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-04T10:52:03Z',
      token: current.qr_token
    },
    {
      actorSubject: actor
    }
  );

  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'scanner_not_allowed');
});

test('admin Telegram users can scan access QR codes', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');

  const current = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  const admin = store.findSubjectByTelegramUsername('Light_epoH');

  assert.ok(current.qr_token);
  assert.ok(admin);
  assert.equal(admin.canScan, true);

  const result = await scanner.scan(
    {
      request_id: 'req_admin_scan',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-04T10:52:03Z',
      token: current.qr_token
    },
    {
      actorSubject: admin
    }
  );

  assert.equal(result.decision, 'allow');
  assert.equal(result.direction, 'enter');
});

test('guard Telegram users can scan access QR codes without admin permissions', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');
  addTestUser(store, 'arineyvert', 'guard');

  const current = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  const guard = store.findSubjectByTelegramUsername('arineyvert');

  assert.ok(current.qr_token);
  assert.ok(guard);
  assert.equal(guard.kind, 'guard');
  assert.equal(guard.canScan, true);

  const result = await scanner.scan(
    {
      request_id: 'req_guard_scan',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-08T10:52:03Z',
      token: current.qr_token
    },
    {
      actorSubject: guard
    }
  );

  assert.equal(result.decision, 'allow');
  assert.equal(result.direction, 'enter');
});

test('same QR token cannot be scanned twice', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');

  const current = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });

  assert.ok(current.qr_token);

  const first = await scanner.scan(
    {
      request_id: 'req_replay_first',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-04T10:52:03Z',
      token: current.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  const replay = await scanner.scan(
    {
      request_id: 'req_replay_second',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-04T10:52:04Z',
      token: current.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );

  assert.equal(first.decision, 'allow');
  assert.equal(replay.decision, 'deny');
  assert.equal(replay.reason_code, 'replay_detected');
});

test('refreshing a dynamic QR invalidates the previous active token', async () => {
  const { store, qr, scanner } = createServices();
  addTestUser(store, 'ta_pri', 'employee');

  const firstQr = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });
  const refreshedQr = await qr.getCurrent({
    telegramUsername: 'ta_pri'
  });

  assert.ok(firstQr.qr_token);
  assert.ok(refreshedQr.qr_token);

  const oldToken = await scanner.scan(
    {
      request_id: 'req_old_qr_after_refresh',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-07T10:52:03Z',
      token: firstQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );
  const newToken = await scanner.scan(
    {
      request_id: 'req_new_qr_after_refresh',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-07T10:52:04Z',
      token: refreshedQr.qr_token
    },
    {
      scannerAuthenticated: true
    }
  );

  assert.equal(oldToken.decision, 'deny');
  assert.equal(oldToken.reason_code, 'qr_replaced');
  assert.equal(newToken.decision, 'allow');
});

test('tenant admin can create static visitor QR for one entry and one exit', async () => {
  const { store, scanner, tokenService } = createServices();
  addTestUser(store, 'l1zzrt', 'tenant_admin');
  const tenantAdmin = store.findSubjectByTelegramUsername('l1zzrt');

  assert.ok(tenantAdmin);
  assert.equal(tenantAdmin.kind, 'tenant_admin');

  const { pass, visitorSubject } = store.createStaticVisitorPass({
    visitorUsername: '@guest_user',
    createdBy: tenantAdmin
  });
  const issued = await tokenService.issueStaticVisitorPassToken({
    visitorPassId: pass.id,
    buildingId: pass.buildingId,
    floorIds: [],
    accessPointClasses: visitorSubject.allowedAccessPointClasses,
    expiresAt: pass.windowEnd
  });

  const enter = await scanner.scan(
    {
      request_id: 'req_static_visitor_enter',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-05T10:52:03Z',
      token: issued.token
    },
    {
      scannerAuthenticated: true
    }
  );
  const secondEnter = await scanner.scan(
    {
      request_id: 'req_static_visitor_enter_again',
      scanner_id: 'scn_main_entry',
      captured_at: '2026-05-05T10:53:03Z',
      token: issued.token
    },
    {
      scannerAuthenticated: true
    }
  );
  const exit = await scanner.scan(
    {
      request_id: 'req_static_visitor_exit',
      scanner_id: 'scn_exit',
      captured_at: '2026-05-05T10:54:03Z',
      token: issued.token
    },
    {
      scannerAuthenticated: true
    }
  );
  const secondExit = await scanner.scan(
    {
      request_id: 'req_static_visitor_exit_again',
      scanner_id: 'scn_exit',
      captured_at: '2026-05-05T10:55:03Z',
      token: issued.token
    },
    {
      scannerAuthenticated: true
    }
  );

  assert.equal(enter.decision, 'allow');
  assert.equal(enter.next_subject_state, 'entered');
  assert.equal(secondEnter.decision, 'deny');
  assert.equal(secondEnter.reason_code, 'visitor_exit_required');
  assert.equal(exit.decision, 'allow');
  assert.equal(exit.next_subject_state, 'exited');
  assert.equal(secondExit.decision, 'deny');
  assert.equal(secondExit.reason_code, 'visitor_pass_closed');
});
