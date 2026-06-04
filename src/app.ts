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
import type { InMemoryAccessStore } from './modules/access/demoStore.js';
import type { QrTokenService } from './modules/qr/tokenService.js';
import type { AccessSubject, RegistrationRequest } from './modules/access/types.js';
import type { AccessEventLogEntry } from './modules/access/types.js';
import {
  accessEventLogResponseSchema,
  faceVerificationRequestSchema,
  registrationRejectBodySchema,
  registrationRequestActionParamsSchema,
  registrationRequestCreateSchema,
  staticVisitorPassCreateSchema,
  userParamsSchema,
  userRoleUpdateSchema
} from './modules/access/schemas.js';
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
  telegramUsername?: string;
  invalidReason?: string;
}

export interface BuildAppOptions {
  env?: AppEnv;
  metrics?: AppMetrics;
  processedUpdatesStore?: ProcessedUpdatesStore;
  accessScannerService?: AccessScannerService;
  currentQrService?: CurrentQrService;
  accessStore?: InMemoryAccessStore;
  qrTokenService?: QrTokenService;
  telegramUpdateHandler?: TelegramUpdateHandler;
  resolveActorSubject?: (identity: RequestIdentity) => AccessSubject | undefined;
  listAccessEvents?: (limit?: number) => AccessEventLogEntry[];
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const publicRoot = path.resolve(currentDirectory, '../public');
const qrSvgQuerySchema = z.object({
  token: z.string().min(1)
});
const accessEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50)
});
const registrationRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});
const telegramFileParamsSchema = z.object({
  fileId: z.string().min(1)
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
    if (env.NODE_ENV !== 'production') {
      const devTelegramUserId = getHeaderValue(headers['x-dev-telegram-user-id']);
      const devTelegramUsername = getHeaderValue(headers['x-dev-telegram-username']);

      if (devTelegramUserId || devTelegramUsername) {
        return {
          telegramUserId: devTelegramUserId,
          telegramUsername: devTelegramUsername
        };
      }
    }

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
      telegramUserId: String(identity.user.id),
      telegramUsername: identity.user.username
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
  const accessStore = options.accessStore;
  const qrTokenService = options.qrTokenService;
  const resolveActorSubject = options.resolveActorSubject ?? (() => undefined);
  const listAccessEvents = options.listAccessEvents ?? (() => []);
  const telegramUpdateHandler =
    options.telegramUpdateHandler ??
    (async () => {
      logger.warn('Telegram update handler is not configured');
    });

  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 10 * 1024 * 1024
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

  app.get('/api/v1/app/state', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    if (!identity.telegramUserId && !identity.telegramUsername) {
      reply.code(401);
      return {
        error: 'open_app_from_telegram'
      };
    }

    const subject = accessStore.findSubjectByTelegramIdentity(
      identity.telegramUserId,
      identity.telegramUsername
    );
    const registrationRequest = identity.telegramUserId
      ? accessStore.findRegistrationRequestByTelegramUserId(identity.telegramUserId)
      : undefined;

    return buildWebAppState(identity, subject, registrationRequest);
  });

  app.post('/api/v1/registration/request', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    if (!identity.telegramUserId) {
      reply.code(401);
      return {
        error: 'open_app_from_telegram'
      };
    }

    const parsedBody = registrationRequestCreateSchema.safeParse(request.body);

    if (!parsedBody.success) {
      reply.code(400);
      return {
        error: 'invalid_registration_payload',
        issues: parsedBody.error.flatten()
      };
    }

    try {
      const registrationRequest = accessStore.createRegistrationRequest({
        telegramUserId: identity.telegramUserId,
        username: identity.telegramUsername,
        fullName: parsedBody.data.full_name,
        requestedRole: parsedBody.data.requested_role,
        consentAccepted: parsedBody.data.consent_accepted,
        photoDataUrl: parsedBody.data.photo_data_url
      });

      return {
        request: serializeRegistrationRequest(registrationRequest)
      };
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : 'registration_failed'
      };
    }
  });

  app.get('/api/v1/registration/requests', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canReviewRegistrationRequests(actor)) {
      reply.code(403);
      return {
        error: 'registration_requests_not_allowed'
      };
    }

    const query = registrationRequestsQuerySchema.parse(request.query);

    return {
      requests: accessStore
        .listRegistrationRequests(query.status ?? 'pending')
        .map(serializeRegistrationRequest)
    };
  });

  app.post('/api/v1/registration/requests/:id/approve', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canReviewRegistrationRequests(actor)) {
      reply.code(403);
      return {
        error: 'registration_approval_not_allowed'
      };
    }

    const params = registrationRequestActionParamsSchema.parse(request.params);
    const approved = accessStore.approveRegistrationRequest(params.id, actor);

    if (!approved) {
      reply.code(404);
      return {
        error: 'registration_request_not_found'
      };
    }

    return {
      request: serializeRegistrationRequest(approved.request),
      subject: serializeSubject(approved.subject)
    };
  });

  app.post('/api/v1/registration/requests/:id/reject', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canReviewRegistrationRequests(actor)) {
      reply.code(403);
      return {
        error: 'registration_reject_not_allowed'
      };
    }

    const params = registrationRequestActionParamsSchema.parse(request.params);
    const body = registrationRejectBodySchema.parse(request.body ?? {});
    const rejected = accessStore.rejectRegistrationRequest(
      params.id,
      actor,
      body.reason
    );

    if (!rejected) {
      reply.code(404);
      return {
        error: 'registration_request_not_found'
      };
    }

    return {
      request: serializeRegistrationRequest(rejected)
    };
  });

  app.get('/api/v1/users', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canManageUsers(actor)) {
      reply.code(403);
      return {
        error: 'users_not_allowed'
      };
    }

    return {
      users: accessStore.listSubjects().map(serializeSubject)
    };
  });

  app.patch('/api/v1/users/:id/role', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canManageUsers(actor)) {
      reply.code(403);
      return {
        error: 'role_update_not_allowed'
      };
    }

    const params = userParamsSchema.parse(request.params);
    const body = userRoleUpdateSchema.parse(request.body);

    if (params.id === actor.id) {
      reply.code(400);
      return {
        error: 'cannot_change_own_role'
      };
    }

    const updated = accessStore.updateUserRoleById(params.id, body.role);

    if (!updated) {
      reply.code(404);
      return {
        error: 'user_not_found'
      };
    }

    return {
      user: serializeSubject(updated)
    };
  });

  app.delete('/api/v1/users/:id', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canManageUsers(actor)) {
      reply.code(403);
      return {
        error: 'user_delete_not_allowed'
      };
    }

    const params = userParamsSchema.parse(request.params);

    if (params.id === actor.id) {
      reply.code(400);
      return {
        error: 'cannot_delete_self'
      };
    }

    const deleted = accessStore.deleteUserById(params.id);

    if (!deleted) {
      reply.code(404);
      return {
        error: 'user_not_found'
      };
    }

    return {
      ok: true
    };
  });

  app.post('/api/v1/visitor-passes/static', async (request, reply) => {
    if (!accessStore || !qrTokenService) {
      reply.code(503);
      return {
        error: 'visitor_pass_service_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId
      ? accessStore.findSubjectByTelegramIdentity(
          identity.telegramUserId,
          identity.telegramUsername
        )
      : undefined;

    if (!canCreateVisitorInvite(actor)) {
      reply.code(403);
      return {
        error: 'visitor_pass_not_allowed'
      };
    }

    const body = staticVisitorPassCreateSchema.parse(request.body);
    const { pass, visitorSubject } = accessStore.createStaticVisitorPass({
      visitorFullName: body.full_name,
      createdBy: actor
    });
    const issued = await qrTokenService.issueStaticVisitorPassToken({
      visitorPassId: pass.id,
      buildingId: pass.buildingId,
      floorIds: [],
      accessPointClasses: visitorSubject.allowedAccessPointClasses,
      expiresAt: pass.windowEnd
    });

    return {
      pass: {
        id: pass.id,
        visitor_full_name: visitorSubject.fullName,
        status: pass.status,
        expires_at: pass.windowEnd.toISOString()
      },
      qr_token: issued.token
    };
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

      const payload = await currentQrService.getCurrent({
        telegramUserId: identity.telegramUserId,
        telegramUsername: identity.telegramUsername
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
        actorSubject: identity.telegramUserId ? resolveActorSubject(identity) : undefined,
        scannerAuthenticated:
          Boolean(env.SCANNER_SHARED_SECRET && scannerSecret === env.SCANNER_SHARED_SECRET)
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

  app.post('/api/v1/access/face-check', async (request, reply) => {
    if (!accessStore) {
      reply.code(503);
      return {
        error: 'access_store_not_configured'
      };
    }

    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId ? resolveActorSubject(identity) : undefined;

    if (!actor?.canScan) {
      reply.code(403);
      return {
        error: 'scanner_not_allowed'
      };
    }

    const parsedBody = faceVerificationRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      reply.code(400);
      return {
        error: 'invalid_face_verification_payload',
        issues: parsedBody.error.flatten()
      };
    }

    const event = accessStore.markAccessEventFaceVerification(
      parsedBody.data.request_id,
      parsedBody.data.matched
    );

    if (!event) {
      reply.code(404);
      return {
        error: 'access_event_not_found'
      };
    }

    return {
      event: serializeAccessEvent(event)
    };
  });

  app.get('/api/v1/access/events', async (request, reply) => {
    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId ? resolveActorSubject(identity) : undefined;

    if (!canViewAudit(actor)) {
      reply.code(403);
      return {
        error: 'audit_not_allowed'
      };
    }

    const query = accessEventsQuerySchema.parse(request.query);
    const events = listAccessEvents(query.limit).map(serializeAccessEvent);

    return accessEventLogResponseSchema.parse({
      events
    });
  });

  app.get('/api/v1/telegram/file/:fileId', async (request, reply) => {
    const identity = resolveRequestIdentity(request.headers, env);

    if (identity.invalidReason) {
      reply.code(401);
      return {
        error: identity.invalidReason
      };
    }

    const actor = identity.telegramUserId ? resolveActorSubject(identity) : undefined;

    if (!actor?.canScan) {
      reply.code(403);
      return {
        error: 'photo_access_denied'
      };
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      reply.code(503);
      return {
        error: 'telegram_bot_token_missing'
      };
    }

    const params = telegramFileParamsSchema.parse(request.params);
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(params.fileId)}`
    );
    const fileInfo = (await fileInfoResponse.json()) as {
      ok?: boolean;
      result?: {
        file_path?: string;
      };
      description?: string;
    };

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      reply.code(404);
      return {
        error: fileInfo.description ?? 'telegram_file_not_found'
      };
    }

    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`
    );

    if (!fileResponse.ok) {
      reply.code(502);
      return {
        error: 'telegram_file_download_failed'
      };
    }

    const bytes = Buffer.from(await fileResponse.arrayBuffer());

    reply.header('cache-control', 'no-store');
    return reply.type(fileResponse.headers.get('content-type') ?? 'image/jpeg').send(bytes);
  });

  return app;
}

function buildWebAppState(
  identity: RequestIdentity,
  subject?: AccessSubject,
  registrationRequest?: RegistrationRequest
) {
  const permissions = {
    can_register: !subject && registrationRequest?.status !== 'pending',
    can_show_qr: Boolean(subject && subject.status === 'active'),
    can_create_visitor_pass: canCreateVisitorInvite(subject),
    can_scan: Boolean(subject?.canScan),
    can_view_audit: canViewAudit(subject),
    can_manage_users: canManageUsers(subject),
    can_review_registration_requests: canReviewRegistrationRequests(subject)
  };

  const tabs = buildAvailableTabs(subject, registrationRequest, permissions);

  return {
    identity: {
      telegram_user_id: identity.telegramUserId ?? null,
      username: identity.telegramUsername ?? null
    },
    subject: subject ? serializeSubject(subject) : null,
    registration_request: registrationRequest
      ? serializeRegistrationRequest(registrationRequest)
      : null,
    permissions,
    tabs
  };
}

function buildAvailableTabs(
  subject: AccessSubject | undefined,
  registrationRequest: RegistrationRequest | undefined,
  permissions: {
    can_register: boolean;
    can_show_qr: boolean;
    can_create_visitor_pass: boolean;
    can_scan: boolean;
    can_view_audit: boolean;
    can_manage_users: boolean;
    can_review_registration_requests: boolean;
  }
) {
  if (!subject && registrationRequest?.status === 'pending') {
    return ['waiting'];
  }

  if (!subject) {
    return ['register'];
  }

  const tabs = ['qr', 'profile'];

  if (permissions.can_create_visitor_pass) {
    tabs.push('visitors');
  }

  if (permissions.can_scan) {
    tabs.push('scanner');
  }

  if (permissions.can_view_audit) {
    tabs.push('audit');
  }

  if (permissions.can_manage_users) {
    tabs.push('users');
  }

  if (permissions.can_review_registration_requests) {
    tabs.push('requests');
  }

  return tabs;
}

function serializeSubject(subject: AccessSubject) {
  return {
    id: subject.id,
    kind: subject.kind,
    role_label: roleLabel(subject.kind),
    full_name: subject.fullName,
    job_title: subject.jobTitle,
    tenant_name: subject.tenantName,
    status: subject.status,
    allowed_access_points: subject.allowedAccessPointClasses,
    can_scan: subject.canScan,
    telegram_username: subject.telegramUsername ?? null,
    photo_file_id: subject.photoFileId ?? null,
    photo_data_url: subject.photoDataUrl ?? null,
    registered_at: subject.registeredAt?.toISOString() ?? null
  };
}

function serializeRegistrationRequest(request: RegistrationRequest) {
  return {
    id: request.id,
    telegram_user_id: request.telegramUserId,
    username: request.username ?? null,
    full_name: request.fullName,
    requested_role: request.requestedRole,
    requested_role_label: roleLabel(request.requestedRole),
    status: request.status,
    consent_accepted: request.consentAccepted,
    photo_data_url: request.photoDataUrl,
    created_at: request.createdAt.toISOString(),
    reviewed_at: request.reviewedAt?.toISOString() ?? null,
    rejection_reason: request.rejectionReason ?? null,
    subject_id: request.subjectId ?? null
  };
}

function serializeAccessEvent(event: AccessEventLogEntry) {
  return {
    id: event.id,
    occurred_at: event.occurredAt.toISOString(),
    request_id: event.requestId,
    scanner_id: event.scannerId,
    access_point_id: event.accessPointId,
    access_point_label: event.accessPointLabel,
    subject_id: event.subjectId,
    subject_name: event.subjectName,
    subject_kind: event.subjectKind,
    tenant_name: event.tenantName,
    direction: event.direction,
    decision: event.decision,
    reason_code: event.reasonCode,
    display_message: event.displayMessage
  };
}

function canCreateVisitorInvite(
  subject?: AccessSubject
): subject is AccessSubject {
  return subject?.kind === 'tenant_admin' || subject?.kind === 'operator';
}

function canManageUsers(subject?: AccessSubject): subject is AccessSubject {
  return subject?.kind === 'operator';
}

function canViewAudit(subject?: AccessSubject): subject is AccessSubject {
  return subject?.kind === 'operator';
}

function canReviewRegistrationRequests(
  subject?: AccessSubject
): subject is AccessSubject {
  return subject?.kind === 'operator';
}

function roleLabel(role: AccessSubject['kind']) {
  return (
    {
      operator: 'администратор',
      tenant_admin: 'админ арендатора',
      employee: 'сотрудник',
      visitor: 'посетитель',
      internal_staff: 'внутренний персонал',
      guard: 'охранник'
    } satisfies Record<AccessSubject['kind'], string>
  )[role];
}
