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

await callTelegramApi('deleteWebhook', {
  drop_pending_updates: false
});

console.log(
  JSON.stringify(
    {
      ok: true
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
