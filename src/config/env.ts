import 'dotenv/config';

import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional()
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  TELEGRAM_BOT_TOKEN: optionalNonEmptyString,
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(1).default('replace-me'),
  TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60),
  SCANNER_SHARED_SECRET: optionalNonEmptyString,
  QR_SIGNING_SECRET: z
    .string()
    .min(32)
    .default('dev-only-change-this-qr-signing-secret'),
  QR_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(45),
  ACCESS_DB_PATH: z.string().min(1).default('data/access.sqlite'),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/tg_access?schema=public'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SENTRY_DSN: optionalNonEmptyString,
  METRICS_PATH: z.string().default('/metrics')
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return envSchema.parse(source);
}

export function createDefaultEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...envSchema.parse({}),
    ...overrides
  };
}
