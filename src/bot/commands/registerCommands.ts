import { InlineKeyboard, type Bot, type Context } from 'grammy';

import type { AppEnv } from '../../config/env.js';

export function registerCommands(bot: Bot<Context>, env: AppEnv) {
  bot.command('start', async (ctx) => {
    await sendAppEntry(ctx, env);
  });

  bot.on('message', async (ctx) => {
    await sendAppEntry(ctx, env);
  });
}

async function sendAppEntry(ctx: Context, env: AppEnv) {
  const keyboard = new InlineKeyboard().webApp(
    'Открыть приложение',
    `${env.PUBLIC_BASE_URL}/app/qr`
  );

  await ctx.reply(
    [
      'Все функции теперь внутри Telegram Web App.',
      'Откройте приложение, чтобы пройти регистрацию, показать QR, создать гостя или открыть сканер по вашей роли.'
    ].join('\n'),
    {
      reply_markup: keyboard
    }
  );
}
