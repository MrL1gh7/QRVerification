import { InlineKeyboard, type Bot, type Context } from 'grammy';

import type { AppEnv } from '../../config/env.js';
import type { InMemoryAccessStore } from '../../modules/access/demoStore.js';

const roleMap = new Map([
  ['operator', 'demo_operator'],
  ['admin', 'demo_tenant_admin'],
  ['tenant_admin', 'demo_tenant_admin'],
  ['employee', 'demo_employee_f3'],
  ['employee2', 'demo_employee_f2'],
  ['visitor', 'demo_visitor'],
  ['staff', 'demo_staff'],
  ['internal_staff', 'demo_staff']
]);

export function registerCommands(
  bot: Bot<Context>,
  env: AppEnv,
  accessStore: InMemoryAccessStore
) {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        'QR access MVP is online.',
        'Use /demo_role operator to enable scanner mode for this Telegram account.',
        'Use /my_qr to open your dynamic QR.',
        'Use /scan to open the scanner app.'
      ].join('\n')
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '/start',
        '/help',
        '/status',
        '/my_qr',
        '/scan',
        '/audit',
        '/demo_role operator|admin|employee|employee2|visitor|staff',
        '/demo_links',
        '/demo_reset_visitor'
      ].join('\n')
    );
  });

  bot.command('status', async (ctx) => {
    const subject = ctx.from
      ? accessStore.findSubjectByTelegramUserId(String(ctx.from.id))
      : undefined;

    if (!subject) {
      await ctx.reply('No demo role is linked yet. Run /demo_role operator or /demo_links.');
      return;
    }

    await ctx.reply(
      [
        `Role: ${subject.kind}`,
        `Name: ${subject.fullName}`,
        `Tenant: ${subject.tenantName}`,
        `Floors: ${subject.allowedFloorIds.join(', ')}`,
        `Can scan: ${subject.canScan ? 'yes' : 'no'}`
      ].join('\n')
    );
  });

  bot.command('my_qr', async (ctx) => {
    const keyboard = new InlineKeyboard().webApp('Open QR', `${env.PUBLIC_BASE_URL}/app/qr`);

    await ctx.reply('Open the QR web app.', {
      reply_markup: keyboard
    });
  });

  bot.command('scan', async (ctx) => {
    const keyboard = new InlineKeyboard().webApp(
      'Open scanner',
      `${env.PUBLIC_BASE_URL}/app/scanner`
    );

    await ctx.reply('Open the scanner web app.', {
      reply_markup: keyboard
    });
  });

  bot.command('audit', async (ctx) => {
    const keyboard = new InlineKeyboard().webApp(
      'Open logs',
      `${env.PUBLIC_BASE_URL}/app/audit`
    );

    await ctx.reply('Open access logs.', {
      reply_markup: keyboard
    });
  });

  bot.command('demo_role', async (ctx) => {
    const telegramUserId = ctx.from?.id;
    const role = String(ctx.match ?? '').trim().toLowerCase();
    const subjectId = roleMap.get(role);

    if (!telegramUserId || !subjectId) {
      await ctx.reply('Usage: /demo_role operator|admin|employee|employee2|visitor|staff');
      return;
    }

    const subject = accessStore.linkTelegramUser(String(telegramUserId), subjectId);

    await ctx.reply(`Linked to demo role: ${subject.kind} (${subject.fullName})`);
  });

  bot.command('demo_links', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .webApp('Operator QR', `${env.PUBLIC_BASE_URL}/app/qr?subject=demo_operator`)
      .row()
      .webApp('Employee F3 QR', `${env.PUBLIC_BASE_URL}/app/qr?subject=demo_employee_f3`)
      .row()
      .webApp('Employee F2 QR', `${env.PUBLIC_BASE_URL}/app/qr?subject=demo_employee_f2`)
      .row()
      .webApp('Visitor QR', `${env.PUBLIC_BASE_URL}/app/qr?subject=demo_visitor`)
      .row()
      .webApp('Scanner', `${env.PUBLIC_BASE_URL}/app/scanner`);

    await ctx.reply('Demo access links:', {
      reply_markup: keyboard
    });
  });

  bot.command('demo_reset_visitor', async (ctx) => {
    accessStore.resetDemoVisitorPass();
    await ctx.reply('Demo visitor pass reset to scheduled.');
  });
}
