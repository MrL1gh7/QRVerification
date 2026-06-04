import { loadEnv } from '../config/env.js';

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const env = loadEnv();

if (!env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const webhookUrl = new URL('/webhooks/telegram', env.PUBLIC_BASE_URL).toString();
const qrAppUrl = new URL('/app/qr', env.PUBLIC_BASE_URL).toString();

await callTelegramApi('setMyCommands', {
  commands: []
});

await callTelegramApi('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'QR-доступ',
    web_app: {
      url: qrAppUrl
    }
  }
});

await callTelegramApi('setWebhook', {
  url: webhookUrl,
  secret_token: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
  allowed_updates: ['message']
});

console.log(
  JSON.stringify(
    {
      ok: true,
      webhookUrl,
      qrAppUrl
    },
    null,
    2
  )
);

async function callTelegramApi<T>(method: string, body: unknown) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  const payload = (await response.json()) as TelegramApiResponse<T>;

  if (!payload.ok) {
    throw new Error(`${method} failed: ${payload.description ?? response.statusText}`);
  }

  return payload.result;
}
