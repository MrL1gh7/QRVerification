import pino from 'pino';

import type { AppEnv } from '../config/env.js';

export function createLogger(env: AppEnv) {
  return pino({
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {
      service: 'tg-building-access',
      environment: env.NODE_ENV
    }
  });
}
