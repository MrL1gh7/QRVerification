import type { CurrentQrResponse } from './schemas.js';
import type { InMemoryAccessStore } from '../access/demoStore.js';
import type { AccessStep, AccessSubject } from '../access/types.js';
import type { QrTokenService } from './tokenService.js';

export interface CurrentQrService {
  getCurrent(input?: CurrentQrRequest): Promise<CurrentQrResponse>;
}

export interface CurrentQrRequest {
  telegramUserId?: string;
  requestedSubjectId?: string;
}

export class ScaffoldCurrentQrService implements CurrentQrService {
  async getCurrent(): Promise<CurrentQrResponse> {
    return {
      mode: 'scaffold',
      step: 'pending',
      expires_at: null,
      refresh_after_ms: null,
      display: {
        full_name: 'Access profile pending',
        job_title: 'Scaffold mode',
        tenant_name: 'Not bound',
        floors: [],
        status: 'pending',
        can_scan: false
      },
      qr_token: null,
      message: 'QR issuance will be added in the next milestone'
    };
  }
}

export class AccessCurrentQrService implements CurrentQrService {
  constructor(
    private readonly store: InMemoryAccessStore,
    private readonly tokenService: QrTokenService
  ) {}

  async getCurrent(input: CurrentQrRequest = {}): Promise<CurrentQrResponse> {
    const actor = input.telegramUserId
      ? this.store.findSubjectByTelegramUserId(input.telegramUserId)
      : undefined;

    const subject = this.resolveSubject(input, actor);

    if (!subject) {
      return {
        mode: 'scaffold',
        step: 'pending',
        expires_at: null,
        refresh_after_ms: null,
        display: {
          full_name: 'No Telegram account linked',
          job_title: 'Run /demo_role operator',
          tenant_name: 'Demo access',
          floors: [],
          status: 'unlinked',
          can_scan: false
        },
        qr_token: null,
        message: 'Telegram account is not linked to an access profile yet'
      };
    }

    if (subject.status !== 'active') {
      return responseWithoutToken(subject, 'revoked', 'Access profile is not active');
    }

    if (subject.kind === 'visitor') {
      return this.issueVisitorToken(subject);
    }

    return this.issueSubjectToken(subject, subject.kind === 'operator' ? 'move' : 'enter');
  }

  private resolveSubject(input: CurrentQrRequest, actor?: AccessSubject) {
    if (input.requestedSubjectId) {
      if (!actor || actor.canScan || actor.id === input.requestedSubjectId) {
        return this.store.getSubject(input.requestedSubjectId);
      }
    }

    return actor;
  }

  private async issueVisitorToken(subject: AccessSubject): Promise<CurrentQrResponse> {
    if (!subject.visitorPassId) {
      return responseWithoutToken(subject, 'revoked', 'Visitor pass is missing');
    }

    const pass = this.store.getVisitorPass(subject.visitorPassId);

    if (!pass) {
      return responseWithoutToken(subject, 'revoked', 'Visitor pass was not found');
    }

    const now = Date.now();

    if (pass.status === 'revoked' || pass.status === 'cancelled') {
      return responseWithoutToken(subject, 'revoked', 'Visitor pass was revoked');
    }

    if (pass.status === 'exited') {
      return responseWithoutToken(subject, 'expired', 'Visitor pass is already closed');
    }

    if (now < pass.windowStart.getTime()) {
      return responseWithoutToken(subject, 'pending', 'Visitor window has not started yet');
    }

    if (now > pass.windowEnd.getTime()) {
      this.store.updateVisitorPassStatus(pass.id, 'expired');
      return responseWithoutToken(subject, 'expired', 'Visitor window has expired');
    }

    const step: AccessStep = pass.status === 'scheduled' ? 'enter' : 'exit';
    return this.issueSubjectToken(subject, step);
  }

  private async issueSubjectToken(
    subject: AccessSubject,
    step: AccessStep
  ): Promise<CurrentQrResponse> {
    const issued = await this.tokenService.issueDisplayToken({
      subject:
        subject.kind === 'visitor' && subject.visitorPassId
          ? `visitor_pass:${subject.visitorPassId}`
          : `user:${subject.id}`,
      subjectKind: subject.kind,
      buildingId: subject.buildingId,
      floorIds: subject.allowedFloorIds,
      accessPointClasses: subject.allowedAccessPointClasses,
      step
    });

    return {
      mode: subject.kind,
      step,
      expires_at: issued.expiresAt.toISOString(),
      refresh_after_ms: 30_000,
      display: buildDisplay(subject),
      qr_token: issued.token,
      message: 'QR token issued'
    };
  }
}

function responseWithoutToken(
  subject: AccessSubject,
  step: CurrentQrResponse['step'],
  message: string
): CurrentQrResponse {
  return {
    mode: subject.kind,
    step,
    expires_at: null,
    refresh_after_ms: null,
    display: buildDisplay(subject),
    qr_token: null,
    message
  };
}

function buildDisplay(subject: AccessSubject) {
  return {
    full_name: subject.fullName,
    job_title: subject.jobTitle,
    tenant_name: subject.tenantName,
    floors: subject.allowedFloorIds.map((floorId) => floorId.replace('f', 'Floor ')),
    status: subject.status,
    can_scan: subject.canScan
  };
}
