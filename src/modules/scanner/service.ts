import type { ScanRequest, ScanResponse } from './schemas.js';
import type { InMemoryAccessStore } from '../access/demoStore.js';
import type { AccessPoint, AccessSubject } from '../access/types.js';
import type { QrTokenService, VerifiedDisplayToken } from '../qr/tokenService.js';

export interface AccessScannerService {
  scan(input: ScanRequest, context?: ScanContext): Promise<ScanResponse>;
}

export interface ScanContext {
  actorSubject?: AccessSubject;
  scannerAuthenticated?: boolean;
}

export class ScaffoldAccessScannerService implements AccessScannerService {
  async scan(input: ScanRequest): Promise<ScanResponse> {
    if (!input.token.startsWith('tgac:v1:')) {
      return {
        decision: 'deny',
        direction: 'enter',
        reason_code: 'invalid_token_prefix',
        next_subject_state: 'unknown',
        display_message: 'Неверный формат QR-кода'
      };
    }

    const compactJws = input.token.slice('tgac:v1:'.length);
    const tokenParts = compactJws.split('.');

    if (tokenParts.length !== 3) {
      return {
        decision: 'deny',
        direction: 'enter',
        reason_code: 'invalid_compact_jws',
        next_subject_state: 'unknown',
        display_message: 'QR-код повреждён'
      };
    }

    return {
      decision: 'deny',
      direction: 'enter',
      reason_code: 'verification_not_configured',
      next_subject_state: 'unknown',
      display_message: 'Сканер работает, но проверка ещё не настроена'
    };
  }
}

export class PolicyAccessScannerService implements AccessScannerService {
  constructor(
    private readonly store: InMemoryAccessStore,
    private readonly tokenService: QrTokenService
  ) {}

  async scan(input: ScanRequest, context: ScanContext = {}): Promise<ScanResponse> {
    const accessPoint = this.store.getAccessPointForScanner(input.scanner_id);
    const record = (response: ScanResponse) => {
      this.store.appendAccessEvent({
        requestId: input.request_id,
        scannerId: input.scanner_id,
        accessPointId: accessPoint?.id,
        accessPointLabel: response.access_point?.label ?? accessPoint?.label,
        subjectId: response.subject?.id,
        subjectName: response.subject?.full_name,
        subjectKind: response.subject?.kind as AccessSubject['kind'] | undefined,
        tenantName: response.subject?.tenant_name,
        direction: response.direction,
        decision: response.decision,
        reasonCode: response.reason_code,
        displayMessage: response.display_message
      });

      return response;
    };

    if (!accessPoint) {
      return record(deny('enter', 'unknown_scanner', 'Сканер неизвестен или отключён'));
    }

    if (!context.scannerAuthenticated && !context.actorSubject?.canScan) {
      return record(
        deny(
          directionForAccessPoint(accessPoint),
          'scanner_not_allowed',
          'Этот Telegram-аккаунт не может сканировать QR-коды',
          accessPoint
        )
      );
    }

    const verifiedToken = await this.verifyToken(input.token, accessPoint);

    if ('decision' in verifiedToken) {
      return record(verifiedToken);
    }

    if (verifiedToken.tokenUse === 'static_visitor' && verifiedToken.subjectKind !== 'visitor') {
      return record(
        deny(
          directionForAccessPoint(accessPoint),
          'invalid_static_visitor_token',
          'Статичный гостевой QR некорректен',
          accessPoint
        )
      );
    }

    if (
      verifiedToken.tokenUse !== 'static_visitor' &&
      !this.store.consumeJti(verifiedToken.jti, verifiedToken.expiresAtEpochSeconds)
    ) {
      return record(
        deny(
          directionForAccessPoint(accessPoint),
          'replay_detected',
          'QR-код уже был использован',
          accessPoint
        )
      );
    }

    if (verifiedToken.subjectKind === 'visitor') {
      return record(this.scanVisitor(verifiedToken, accessPoint));
    }

    const subject = this.store.findSubjectForTokenSubject(verifiedToken.subject);

    if (!subject) {
      return record(
        deny(
          directionForAccessPoint(accessPoint),
          'subject_not_found',
          'Пользователь не найден',
          accessPoint
        )
      );
    }

    if (
      verifiedToken.tokenUse === 'display' &&
      !this.store.isActiveDisplayJti(subject.id, verifiedToken.jti)
    ) {
      return record(
        deny(
          directionForAccessPoint(accessPoint),
          'qr_replaced',
          'QR-код был обновлён и больше не активен',
          accessPoint,
          subject
        )
      );
    }

    return record(this.scanSubject(subject, verifiedToken, accessPoint));
  }

  private async verifyToken(token: string, accessPoint: AccessPoint) {
    try {
      return await this.tokenService.verifyDisplayToken(token);
    } catch (error) {
      return deny(
        directionForAccessPoint(accessPoint),
        error instanceof Error ? error.message : 'invalid_token',
        'QR-код недействителен или истёк',
        accessPoint
      );
    }
  }

  private scanSubject(
    subject: AccessSubject,
    token: VerifiedDisplayToken,
    accessPoint: AccessPoint
  ): ScanResponse {
    const direction = directionForAccessPoint(accessPoint);

    if (subject.status !== 'active') {
      return deny(direction, 'subject_inactive', 'Профиль доступа не активен', accessPoint, subject);
    }

    if (!subject.allowedAccessPointClasses.includes(accessPoint.class)) {
      return deny(
        direction,
        'access_point_class_not_allowed',
        'Эта точка доступа не разрешена',
        accessPoint,
        subject
      );
    }

    if (!token.accessPointClasses.includes(accessPoint.class)) {
      return deny(
        direction,
        'token_access_point_class_not_allowed',
        'QR-код не разрешает эту точку доступа',
        accessPoint,
        subject
      );
    }

    if (accessPoint.floorId && !subject.allowedFloorIds.includes(accessPoint.floorId)) {
      return deny(direction, 'floor_not_allowed', 'Этот этаж не разрешён', accessPoint, subject);
    }

    if (accessPoint.floorId && !token.floorIds.includes(accessPoint.floorId)) {
      return deny(
        direction,
        'token_floor_not_allowed',
        'QR-код не разрешает этот этаж',
        accessPoint,
        subject
      );
    }

    return allow(direction, subject.status, 'Доступ разрешён', accessPoint, subject);
  }

  private scanVisitor(token: VerifiedDisplayToken, accessPoint: AccessPoint): ScanResponse {
    const direction = directionForAccessPoint(accessPoint);
    const pass = this.store.findVisitorPassForTokenSubject(token.subject);

    if (!pass) {
      return deny(direction, 'visitor_pass_not_found', 'Гостевой пропуск не найден', accessPoint);
    }

    const subject = this.store.getSubject(pass.visitorSubjectId);

    if (!subject) {
      return deny(direction, 'visitor_not_found', 'Профиль посетителя не найден', accessPoint);
    }

    const now = Date.now();

    if (pass.status === 'revoked' || pass.status === 'cancelled') {
      return deny(direction, 'visitor_pass_revoked', 'Гостевой пропуск отозван', accessPoint, subject);
    }

    if (pass.status === 'exited') {
      return deny(direction, 'visitor_pass_closed', 'Гостевой пропуск уже закрыт', accessPoint, subject);
    }

    if (now < pass.windowStart.getTime() || now > pass.windowEnd.getTime()) {
      return deny(direction, 'visitor_window_closed', 'Окно доступа посетителя закрыто', accessPoint, subject);
    }

    if (pass.status === 'scheduled') {
      if (accessPoint.class !== 'MAIN_ENTRY') {
        return deny(
          direction,
          'visitor_must_enter_first',
          'Посетитель должен сначала войти через главный вход',
          accessPoint,
          subject
        );
      }

      this.store.updateVisitorPassStatus(pass.id, 'entered');
      return allow('enter', 'entered', 'Посетитель вошёл', accessPoint, subject);
    }

    if (pass.status === 'entered') {
      if (accessPoint.class === 'EXIT') {
        this.store.updateVisitorPassStatus(pass.id, 'exited');
        return allow('exit', 'exited', 'Посетитель вышел', accessPoint, subject);
      }

      if (accessPoint.floorId && accessPoint.floorId !== pass.floorId) {
        return deny(direction, 'visitor_floor_not_allowed', 'Этаж посетителя не разрешён', accessPoint, subject);
      }

      if (accessPoint.class === 'LIFT' || accessPoint.class === 'STAIR_LANDING') {
        return allow('move', 'entered', 'Доступ посетителя разрешён', accessPoint, subject);
      }

      return deny(
        direction,
        'visitor_exit_required',
        'Посетитель уже внутри, доступен только выход',
        accessPoint,
        subject
      );
    }

    return deny(direction, `visitor_pass_${pass.status}`, 'Гостевой пропуск не активен', accessPoint, subject);
  }
}

function directionForAccessPoint(accessPoint: AccessPoint): ScanResponse['direction'] {
  if (accessPoint.class === 'EXIT') {
    return 'exit';
  }

  if (accessPoint.class === 'LIFT' || accessPoint.class === 'STAIR_LANDING') {
    return 'move';
  }

  return 'enter';
}

function allow(
  direction: ScanResponse['direction'],
  nextSubjectState: string,
  displayMessage: string,
  accessPoint: AccessPoint,
  subject: AccessSubject
): ScanResponse {
  return {
    decision: 'allow',
    direction,
    reason_code: 'ok',
    next_subject_state: nextSubjectState,
    display_message: displayMessage,
    subject: displaySubject(subject),
    access_point: displayAccessPoint(accessPoint)
  };
}

function deny(
  direction: ScanResponse['direction'],
  reasonCode: string,
  displayMessage: string,
  accessPoint?: AccessPoint,
  subject?: AccessSubject
): ScanResponse {
  return {
    decision: 'deny',
    direction,
    reason_code: reasonCode,
    next_subject_state: 'unchanged',
    display_message: displayMessage,
    subject: subject ? displaySubject(subject) : undefined,
    access_point: accessPoint ? displayAccessPoint(accessPoint) : undefined
  };
}

function displaySubject(subject: AccessSubject) {
  return {
    id: subject.id,
    kind: subject.kind,
    full_name: subject.fullName,
    tenant_name: subject.tenantName,
    floors: subject.allowedFloorIds,
    photo_file_id: subject.photoFileId,
    photo_data_url: subject.photoDataUrl
  };
}

function displayAccessPoint(accessPoint: AccessPoint) {
  return {
    id: accessPoint.id,
    label: accessPoint.label,
    class: accessPoint.class
  };
}
