import { Bot, type Context } from 'grammy';

import type { AppEnv } from '../config/env.js';
import type { InMemoryAccessStore } from '../modules/access/demoStore.js';
import type { QrTokenService } from '../modules/qr/tokenService.js';
import { registerCommands } from './commands/registerCommands.js';

export function createBot(
  env: AppEnv,
  accessStore: InMemoryAccessStore,
  qrTokenService: QrTokenService
) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const bot = new Bot<Context>(env.TELEGRAM_BOT_TOKEN);

  void accessStore;
  void qrTokenService;

  registerCommands(bot, env);

  bot.catch((error) => {
    console.error('Telegram bot error', error.error);
  });

  return bot;
}
