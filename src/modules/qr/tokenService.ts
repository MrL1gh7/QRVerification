import { randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import type { AppEnv } from '../../config/env.js';
import type { AccessPointClass, AccessStep, SubjectKind } from '../access/types.js';

export const QR_TOKEN_PREFIX = 'tgac:v1:';

export interface DisplayTokenInput {
  subject: string;
  subjectKind: SubjectKind;
  buildingId: string;
  floorIds: string[];
  accessPointClasses: AccessPointClass[];
  step: AccessStep;
}

export interface StaticVisitorPassTokenInput {
  visitorPassId: string;
  buildingId: string;
  floorIds: string[];
  accessPointClasses: AccessPointClass[];
  expiresAt: Date;
}

export type QrTokenUse = 'display' | 'static_visitor';

export interface VerifiedDisplayToken {
  subject: string;
  jti: string;
  subjectKind: SubjectKind;
  tokenUse: QrTokenUse;
  buildingId: string;
  floorIds: string[];
  accessPointClasses: AccessPointClass[];
  step: AccessStep;
  expiresAtEpochSeconds: number;
}

export class QrTokenService {
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(private readonly env: AppEnv) {
    this.secret = new TextEncoder().encode(env.QR_SIGNING_SECRET);
    this.ttlSeconds = env.QR_TOKEN_TTL_SECONDS;
  }

  async issueDisplayToken(input: DisplayTokenInput) {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const jti = randomUUID();

    const token = await new SignJWT({
      typ: input.subjectKind,
      tk: 'display',
      bid: input.buildingId,
      fl: input.floorIds,
      ap: input.accessPointClasses,
      st: input.step
    })
      .setProtectedHeader({
        alg: 'HS256',
        typ: 'JWT'
      })
      .setIssuer('uk-building-access')
      .setAudience('access-scanner')
      .setSubject(input.subject)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secret);

    return {
      token: `${QR_TOKEN_PREFIX}${token}`,
      expiresAt: new Date(expiresAt * 1_000),
      expiresAtEpochSeconds: expiresAt,
      jti
    };
  }

  async issueStaticVisitorPassToken(input: StaticVisitorPassTokenInput) {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
    const jti = randomUUID();

    if (expiresAt <= issuedAt) {
      throw new Error('static_visitor_token_expired');
    }

    const token = await new SignJWT({
      typ: 'visitor',
      tk: 'static_visitor',
      bid: input.buildingId,
      fl: input.floorIds,
      ap: input.accessPointClasses,
      st: 'enter'
    })
      .setProtectedHeader({
        alg: 'HS256',
        typ: 'JWT'
      })
      .setIssuer('uk-building-access')
      .setAudience('access-scanner')
      .setSubject(`visitor_pass:${input.visitorPassId}`)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secret);

    return {
      token: `${QR_TOKEN_PREFIX}${token}`,
      expiresAt: new Date(expiresAt * 1_000),
      expiresAtEpochSeconds: expiresAt,
      jti
    };
  }

  async verifyDisplayToken(token: string): Promise<VerifiedDisplayToken> {
    if (!token.startsWith(QR_TOKEN_PREFIX)) {
      throw new Error('invalid_token_prefix');
    }

    const compactJws = token.slice(QR_TOKEN_PREFIX.length);
    const result = await jwtVerify(compactJws, this.secret, {
      issuer: 'uk-building-access',
      audience: 'access-scanner'
    });

    return parseClaims(result.payload);
  }
}

function parseClaims(payload: JWTPayload): VerifiedDisplayToken {
  if (
    !payload.sub ||
    !payload.jti ||
    !payload.exp ||
    typeof payload.typ !== 'string' ||
    typeof payload.bid !== 'string' ||
    !Array.isArray(payload.fl) ||
    !Array.isArray(payload.ap) ||
    typeof payload.st !== 'string'
  ) {
    throw new Error('invalid_token_claims');
  }

  return {
    subject: payload.sub,
    jti: payload.jti,
    subjectKind: payload.typ as SubjectKind,
    tokenUse: payload.tk === 'static_visitor' ? 'static_visitor' : 'display',
    buildingId: payload.bid,
    floorIds: payload.fl.filter((item): item is string => typeof item === 'string'),
    accessPointClasses: payload.ap.filter(
      (item): item is AccessPointClass => typeof item === 'string'
    ),
    step: payload.st as AccessStep,
    expiresAtEpochSeconds: payload.exp
  };
}
