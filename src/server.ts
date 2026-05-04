import { createBot } from './bot/createBot.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './infra/logger.js';
import { createMetrics } from './infra/metrics/index.js';
import { MemoryProcessedUpdatesStore } from './infra/telegram/processedUpdatesStore.js';
import { InMemoryAccessStore } from './modules/access/demoStore.js';
import { AccessCurrentQrService } from './modules/qr/service.js';
import { QrTokenService } from './modules/qr/tokenService.js';
import { PolicyAccessScannerService } from './modules/scanner/service.js';
import { buildApp } from './app.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  const metrics = createMetrics();
  const accessStore = new InMemoryAccessStore();
  const qrTokenService = new QrTokenService(env);
  const bot = createBot(env, accessStore);

  if (bot) {
    await bot.init();
  }

  const app = await buildApp({
    env,
    metrics,
    processedUpdatesStore: new MemoryProcessedUpdatesStore(),
    currentQrService: new AccessCurrentQrService(accessStore, qrTokenService),
    accessScannerService: new PolicyAccessScannerService(accessStore, qrTokenService),
    resolveActorSubject: (telegramUserId) =>
      accessStore.findSubjectByTelegramUserId(telegramUserId),
    listAccessEvents: (limit) => accessStore.listAccessEvents(limit),
    telegramUpdateHandler: async (update) => {
      if (!bot) {
        logger.warn({ updateId: update.update_id }, 'Bot token is missing, update ignored');
        return;
      }

      await bot.handleUpdate(update as never);
    }
  });

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });

    logger.info(
      {
        host: env.HOST,
        port: env.PORT,
        publicBaseUrl: env.PUBLIC_BASE_URL
      },
      'HTTP server is ready'
    );
  } catch (error) {
    logger.error(error, 'Failed to start HTTP server');
    process.exitCode = 1;
  }
}

void main();
