import assert from 'node:assert/strict';
import test from 'node:test';

import { loadEnv } from '../../src/config/env.js';

test('empty optional secrets from .env.example do not block local demo startup', () => {
  const env = loadEnv({
    NODE_ENV: 'development',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    TELEGRAM_BOT_TOKEN: '',
    SCANNER_SHARED_SECRET: '',
    SENTRY_DSN: '',
    QR_SIGNING_SECRET: 'dev-only-change-this-qr-signing-secret'
  });

  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(env.SCANNER_SHARED_SECRET, undefined);
  assert.equal(env.SENTRY_DSN, undefined);
});
