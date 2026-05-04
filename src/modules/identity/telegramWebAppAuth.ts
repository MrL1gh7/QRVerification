import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedTelegramWebAppIdentity {
  user: TelegramWebAppUser;
  authDate: Date;
}

export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number
): VerifiedTelegramWebAppIdentity {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');

  if (!receivedHash) {
    throw new Error('telegram_hash_missing');
  }

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (!safeCompareHex(receivedHash, calculatedHash)) {
    throw new Error('telegram_hash_invalid');
  }

  const authDateRaw = params.get('auth_date');
  const authDateSeconds = authDateRaw ? Number(authDateRaw) : Number.NaN;

  if (!Number.isFinite(authDateSeconds)) {
    throw new Error('telegram_auth_date_missing');
  }

  const ageSeconds = Math.floor(Date.now() / 1_000) - authDateSeconds;

  if (ageSeconds > maxAgeSeconds) {
    throw new Error('telegram_auth_date_expired');
  }

  const userRaw = params.get('user');

  if (!userRaw) {
    throw new Error('telegram_user_missing');
  }

  return {
    user: JSON.parse(userRaw) as TelegramWebAppUser,
    authDate: new Date(authDateSeconds * 1_000)
  };
}

export function getTelegramInitDataFromHeaders(
  headers: Record<string, string | string[] | undefined>
) {
  const initDataHeader = getHeaderValue(headers['x-telegram-init-data']);

  if (initDataHeader) {
    return initDataHeader;
  }

  const authorization = getHeaderValue(headers.authorization);

  if (!authorization?.toLowerCase().startsWith('tma ')) {
    return undefined;
  }

  return authorization.slice('tma '.length);
}

function getHeaderValue(header: string | string[] | undefined) {
  return Array.isArray(header) ? header[0] : header;
}

function safeCompareHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
