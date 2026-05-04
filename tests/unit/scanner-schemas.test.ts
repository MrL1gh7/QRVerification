import assert from 'node:assert/strict';
import test from 'node:test';

import { scanRequestSchema } from '../../src/modules/scanner/schemas.js';

test('scan request schema accepts valid scaffold payload', () => {
  const parsed = scanRequestSchema.parse({
    request_id: 'req_01',
    scanner_id: 'scn_main_a',
    captured_at: '2026-04-23T10:52:03Z',
    token: 'tgac:v1:header.payload.signature'
  });

  assert.equal(parsed.request_id, 'req_01');
});
