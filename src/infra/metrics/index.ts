import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export interface AppMetrics {
  registry: Registry;
  telegramUpdatesTotal: Counter<string>;
  telegramUpdateDuplicatesTotal: Counter<string>;
  scanRequestsTotal: Counter<string>;
  scanAllowTotal: Counter<string>;
  scanDenyTotal: Counter<'reason_code'>;
  scanLatencyMs: Histogram<string>;
  qrTokensIssuedTotal: Counter<'type'>;
}

export function createMetrics(): AppMetrics {
  const registry = new Registry();

  collectDefaultMetrics({
    register: registry,
    prefix: 'tg_access_'
  });

  return {
    registry,
    telegramUpdatesTotal: new Counter({
      name: 'telegram_updates_total',
      help: 'Total Telegram updates received by the webhook',
      registers: [registry]
    }),
    telegramUpdateDuplicatesTotal: new Counter({
      name: 'telegram_update_duplicates_total',
      help: 'Duplicate Telegram updates rejected by update_id',
      registers: [registry]
    }),
    scanRequestsTotal: new Counter({
      name: 'scan_requests_total',
      help: 'Total access scan requests received',
      registers: [registry]
    }),
    scanAllowTotal: new Counter({
      name: 'scan_allow_total',
      help: 'Total access scan requests allowed',
      registers: [registry]
    }),
    scanDenyTotal: new Counter({
      name: 'scan_deny_total',
      help: 'Total access scan requests denied',
      labelNames: ['reason_code'],
      registers: [registry]
    }),
    scanLatencyMs: new Histogram({
      name: 'scan_latency_ms',
      help: 'Latency of access scan processing in milliseconds',
      buckets: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500],
      registers: [registry]
    }),
    qrTokensIssuedTotal: new Counter({
      name: 'qr_tokens_issued_total',
      help: 'Short-lived QR tokens issued by type',
      labelNames: ['type'],
      registers: [registry]
    })
  };
}
