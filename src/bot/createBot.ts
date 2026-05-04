import { Bot, type Context } from 'grammy';

import type { AppEnv } from '../config/env.js';
import type { InMemoryAccessStore } from '../modules/access/demoStore.js';
import { registerCommands } from './commands/registerCommands.js';

export function createBot(env: AppEnv, accessStore: InMemoryAccessStore) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const bot = new Bot<Context>(env.TELEGRAM_BOT_TOKEN);

  registerCommands(bot, env, accessStore);

  bot.catch((error) => {
    console.error('Telegram bot error', error.error);
  });

  return bot;
}
