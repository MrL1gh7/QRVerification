import type { CurrentQrResponse } from './schemas.js';
import type { InMemoryAccessStore } from '../access/demoStore.js';
import type { AccessStep, AccessSubject } from '../access/types.js';
import type { QrTokenService } from './tokenService.js';

export interface CurrentQrService {
  getCurrent(input?: CurrentQrRequest): Promise<CurrentQrResponse>;
}

export interface CurrentQrRequest {
  telegramUserId?: string;
  telegramUsername?: string;
}

export class ScaffoldCurrentQrService implements CurrentQrService {
  async getCurrent(): Promise<CurrentQrResponse> {
    return {
      mode: 'scaffold',
      step: 'pending',
      expires_at: null,
      refresh_after_ms: null,
      display: {
        full_name: 'Профиль доступа не настроен',
        job_title: 'Режим заготовки',
        tenant_name: 'Не привязан',
        floors: [],
        status: 'pending',
        can_scan: false
      },
      qr_token: null,
      message: 'Выдача QR будет настроена на следующем этапе'
    };
  }
}

export class AccessCurrentQrService implements CurrentQrService {
  constructor(
    private readonly store: InMemoryAccessStore,
    private readonly tokenService: QrTokenService
  ) {}

  async getCurrent(input: CurrentQrRequest = {}): Promise<CurrentQrResponse> {
    const subject = this.store.findSubjectByTelegramIdentity(
      input.telegramUserId,
      input.telegramUsername
    );

    if (!subject) {
      return {
        mode: 'scaffold',
        step: 'pending',
        expires_at: null,
        refresh_after_ms: null,
        display: {
          full_name: 'Доступ не настроен',
          job_title: 'Пользователь не найден в списке',
          tenant_name: 'Доступ в здание',
          floors: [],
          status: 'unlinked',
          can_scan: false
        },
        qr_token: null,
        message: 'Ваш Telegram username пока не добавлен в список доступа'
      };
    }

    if (subject.status !== 'active') {
      return responseWithoutToken(subject, 'revoked', 'Профиль доступа не активен');
    }

    if (subject.kind === 'visitor') {
      return this.issueVisitorToken(subject);
    }

    return this.issueSubjectToken(subject, subject.kind === 'operator' ? 'move' : 'enter');
  }

  private async issueVisitorToken(subject: AccessSubject): Promise<CurrentQrResponse> {
    if (!subject.visitorPassId) {
      return responseWithoutToken(subject, 'revoked', 'Гостевой пропуск не найден');
    }

    const pass = this.store.getVisitorPass(subject.visitorPassId);

    if (!pass) {
      return responseWithoutToken(subject, 'revoked', 'Гостевой пропуск не найден');
    }

    const now = Date.now();

    if (pass.status === 'revoked' || pass.status === 'cancelled') {
      return responseWithoutToken(subject, 'revoked', 'Гостевой пропуск отозван');
    }

    if (pass.status === 'exited') {
      return responseWithoutToken(subject, 'expired', 'Гостевой пропуск уже закрыт');
    }

    if (now < pass.windowStart.getTime()) {
      return responseWithoutToken(subject, 'pending', 'Окно визита ещё не началось');
    }

    if (now > pass.windowEnd.getTime()) {
      this.store.updateVisitorPassStatus(pass.id, 'expired');
      return responseWithoutToken(subject, 'expired', 'Окно визита истекло');
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
          : `qr_session:${subject.id}`,
      subjectKind: subject.kind,
      buildingId: subject.buildingId,
      floorIds: subject.allowedFloorIds,
      accessPointClasses: subject.allowedAccessPointClasses,
      step
    });

    this.store.setActiveDisplayJti(subject.id, issued.jti);

    return {
      mode: subject.kind,
      step,
      expires_at: issued.expiresAt.toISOString(),
      refresh_after_ms: 30_000,
      display: buildDisplay(subject),
      qr_token: issued.token,
      message: 'QR-код выпущен'
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
    floors: subject.allowedFloorIds.length
      ? subject.allowedFloorIds.map((floorId) => `Этаж ${floorId.replace('f', '')}`)
      : ['Главный вход и выход'],
    status: subject.status,
    can_scan: subject.canScan
  };
}
