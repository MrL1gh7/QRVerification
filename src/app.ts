import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';

import type { AppEnv } from './config/env.js';
import { createDefaultEnv } from './config/env.js';
import type { AppMetrics } from './infra/metrics/index.js';
import { createMetrics } from './infra/metrics/index.js';
import { createLogger } from './infra/logger.js';
import {
  MemoryProcessedUpdatesStore,
  type ProcessedUpdatesStore
} from './infra/telegram/processedUpdatesStore.js';
import type { AccessSubject } from './modules/access/types.js';
import type { AccessEventLogEntry } from './modules/access/types.js';
import { accessEventLogResponseSchema } from './modules/access/schemas.js';
import {
  getTelegramInitDataFromHeaders,
  verifyTelegramWebAppInitData
} from './modules/identity/telegramWebAppAuth.js';
import { currentQrResponseSchema } from './modules/qr/schemas.js';
import {
  ScaffoldCurrentQrService,
  type CurrentQrService
} from './modules/qr/service.js';
import { scanRequestSchema, scanResponseSchema } from './modules/scanner/schemas.js';
import {
  ScaffoldAccessScannerService,
  type AccessScannerService
} from './modules/scanner/service.js';
import {
  telegramUpdateSchema,
  type TelegramUpdate
} from './modules/webhooks/telegram.schemas.js';

export type TelegramUpdateHandler = (update: TelegramUpdate) => Promise<void>;

interface RequestIdentity {
  telegramUserId?: string;
  invalidReason?: string;
}

export interface BuildAppOptions {
  env?: AppEnv;
  metrics?: AppMetrics;
  processedUpdatesStore?: ProcessedUpdatesStore;
  accessScannerService?: AccessScannerService;
  currentQrService?: CurrentQrService;
  telegramUpdateHandler?: TelegramUpdateHandler;
  resolveActorSubject?: (telegramUserId: string) => AccessSubject | undefined;
  listAccessEvents?: (limit?: number) => AccessEventLogEntry[];
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const publicRoot = path.resolve(currentDirectory, '../public');
const currentQrQuerySchema = z.object({
  subject: z.string().optional(),
  demo_user_id: z.string().optional()
});
const qrSvgQuerySchema = z.object({
  token: z.string().min(1)
});
const accessEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50)
});

function getHeaderValue(header: string | string[] | undefined) {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

function resolveRequestIdentity(
  headers: Record<string, string | string[] | undefined>,
  env: AppEnv
): RequestIdentity {
  const initData = getTelegramInitDataFromHeaders(headers);

  if (!initData) {
    return {};
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      invalidReason: 'telegram_bot_token_missing'
    };
  }

  try {
    const identity = verifyTelegramWebAppInitData(
      initData,
      env.TELEGRAM_BOT_TOKEN,
      env.TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS
    );

    return {
      telegramUserId: String(identity.user.id)
    };
  } catch (error) {
    return {
      invalidReason: error instanceof Error ? error.message : 'telegram_auth_invalid'
    };
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  const env = options.env ?? createDefaultEnv();
  const logger = createLogger(env);
  const metrics = options.metrics ?? createMetrics();
  const processedUpdatesStore =
    options.processedUpdatesStore ?? new MemoryProcessedUpdatesStore();
  const accessScannerService =
    options.accessScannerService ?? new ScaffoldAccessScannerService();
  const currentQrService = options.currentQrService ?? new ScaffoldCurrentQrService();
  const resolveActorSubject = options.resolveActorSubject ?? (() => undefined);
  const listAccessEvents = options.listAccessEvents ?? (() => []);
  const telegramUpdateHandler =
    options.telegramUpdateHandler ??
    (async () => {
      logger.warn('Telegram update handler is not configured');
    });

  const app = Fastify({
    loggerInstance: logger
  });

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  });

  await app.register(rateLimit, {
    global: false
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Telegram Building Access API',
        version: '0.1.0'
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  await app.register(fastifyStatic, {
    root: publicRoot
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header(
      'Permissions-Policy',
      'camera=(self), microphone=(), geolocation=(), fullscreen=(self)'
    );

    return payload;
  });

  app.get('/healthz', async () => {
    return {
      status: 'ok',
      service: 'tg-building-access'
    };
  });

  app.get(env.METRICS_PATH, async (_request, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.get('/app/qr', async (_request, reply) => {
    return reply.type('text/html').sendFile('qr-app/index.html');
  });

  app.get('/app/scanner', async (_request, reply) => {
    return reply.type('text/html').sendFile('scanner-app/index.html');
  });

  app.get('/app/audit', async (_request, reply) => {
    return reply.type('text/html').sendFile('audit-app/index.html');
  });

  app.get(
    '/api/v1/qr/current',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const identity = resolveRequestIdentity(request.headers, env);

      if (identity.invalidReason) {
        reply.code(401);
        return {
          error: identity.invalidReason
        };
      }

      const query = currentQrQuerySchema.parse(request.query);
      const payload = await currentQrService.getCurrent({
        telegramUserId: identity.telegramUserId,
        requestedSubjectId: query.subject ?? query.demo_user_id
      });

      return currentQrResponseSchema.parse(payload);
    }
  );

  app.get(
    '/api/v1/qr/svg',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const query = qrSvgQuerySchema.parse(request.query);
      const svg = await QRCode.toString(query.token, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320
      });

      return reply.type('image/svg+xml').send(svg);
    }
  );

  app.post(
    '/webhooks/telegram',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const secretHeader = getHeaderValue(
        request.headers['x-telegram-bot-api-secret-token']
      );

      if (
        env.TELEGRAM_WEBHOOK_SECRET_TOKEN &&
        secretHeader !== env.TELEGRAM_WEBHOOK_SECRET_TOKEN
      ) {
        reply.code(401);
        return {
          ok: false,
          error: 'invalid_telegram_secret'
        };
      }

      const parsedUpdate = telegramUpdateSchema.safeParse(request.body);

      if (!parsedUpdate.success) {
        reply.code(400);
        return {
          ok: false,
          error: 'invalid_update_payload',
          issues: parsedUpdate.error.flatten()
        };
      }

      metrics.telegramUpdatesTotal.inc();

      if (await processedUpdatesStore.has(parsedUpdate.data.update_id)) {
        metrics.telegramUpdateDuplicatesTotal.inc();
        return {
          ok: true,
          duplicate: true
        };
      }

      await telegramUpdateHandler(parsedUpdate.data);
      await processedUpdatesStore.mark(parsedUpdate.data.update_id);

      return {
        ok: true
      };
    }
  );

  app.post(
    '/api/v1/access/scan',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const scannerSecret = getHeaderValue(request.headers['x-scanner-key']);
      const identity = resolveRequestIdentity(request.headers, env);

      if (env.SCANNER_SHARED_SECRET && scannerSecret !== env.SCANNER_SHARED_SECRET) {
        reply.code(401);
        return {
          error: 'invalid_scanner_secret'
        };
      }

      if (identity.invalidReason) {
        reply.code(401);
        return {
          error: identity.invalidReason
        };
      }

      const parsedRequest = scanRequestSchema.safeParse(request.body);

      if (!parsedRequest.success) {
        reply.code(400);
        return {
          error: 'invalid_scan_payload',
          issues: parsedRequest.error.flatten()
        };
      }

      metrics.scanRequestsTotal.inc();

      const startTime = performance.now();
      const decision = await accessScannerService.scan(parsedRequest.data, {
        actorSubject: identity.telegramUserId
          ? resolveActorSubject(identity.telegramUserId)
          : undefined,
        scannerAuthenticated:
          Boolean(env.SCANNER_SHARED_SECRET && scannerSecret === env.SCANNER_SHARED_SECRET) ||
          (!env.SCANNER_SHARED_SECRET && !identity.telegramUserId)
      });
      metrics.scanLatencyMs.observe(performance.now() - startTime);

      if (decision.decision === 'allow') {
        metrics.scanAllowTotal.inc();
      } else {
        metrics.scanDenyTotal.labels(decision.reason_code).inc();
      }

      return scanResponseSchema.parse(decision);
    }
  );

  app.get('/api/v1/access/events', async (request) => {
    const query = accessEventsQuerySchema.parse(request.query);
    const events = listAccessEvents(query.limit).map((event) => ({
      id: event.id,
      occurred_at: event.occurredAt.toISOString(),
      request_id: event.requestId,
      scanner_id: event.scannerId,
      access_point_id: event.accessPointId,
      access_point_label: event.accessPointLabel,
      subject_name: event.subjectName,
      subject_kind: event.subjectKind,
      tenant_name: event.tenantName,
      direction: event.direction,
      decision: event.decision,
      reason_code: event.reasonCode,
      display_message: event.displayMessage
    }));

    return accessEventLogResponseSchema.parse({
      events
    });
  });

  return app;
}
