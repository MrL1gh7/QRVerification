import 'dotenv/config';

import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(1).default('replace-me'),
  TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60),
  SCANNER_SHARED_SECRET: z.string().min(1).optional(),
  QR_SIGNING_SECRET: z
    .string()
    .min(32)
    .default('dev-only-change-this-qr-signing-secret'),
  QR_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(45),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/tg_access?schema=public'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SENTRY_DSN: z.string().min(1).optional(),
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
