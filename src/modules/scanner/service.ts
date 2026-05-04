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
        display_message: 'Invalid QR token format'
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
        display_message: 'Compact JWS payload is malformed'
      };
    }

    return {
      decision: 'deny',
      direction: 'enter',
      reason_code: 'verification_not_configured',
      next_subject_state: 'unknown',
      display_message: 'Scanner scaffold is online, verification is not configured yet'
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

    if (!accessPoint) {
      return deny('enter', 'unknown_scanner', 'Scanner is unknown or disabled');
    }

    if (!context.scannerAuthenticated && !context.actorSubject?.canScan) {
      return deny(
        directionForAccessPoint(accessPoint),
        'scanner_not_allowed',
        'This Telegram account cannot scan access QR codes',
        accessPoint
      );
    }

    const verifiedToken = await this.verifyToken(input.token, accessPoint);

    if ('decision' in verifiedToken) {
      return verifiedToken;
    }

    if (
      !this.store.consumeJti(
        verifiedToken.jti,
        verifiedToken.expiresAtEpochSeconds
      )
    ) {
      return deny(
        directionForAccessPoint(accessPoint),
        'replay_detected',
        'QR token was already used',
        accessPoint
      );
    }

    if (verifiedToken.subjectKind === 'visitor') {
      return this.scanVisitor(verifiedToken, accessPoint);
    }

    const subject = this.store.findSubjectForTokenSubject(verifiedToken.subject);

    if (!subject) {
      return deny(
        directionForAccessPoint(accessPoint),
        'subject_not_found',
        'Access subject was not found',
        accessPoint
      );
    }

    return this.scanSubject(subject, verifiedToken, accessPoint);
  }

  private async verifyToken(token: string, accessPoint: AccessPoint) {
    try {
      return await this.tokenService.verifyDisplayToken(token);
    } catch (error) {
      return deny(
        directionForAccessPoint(accessPoint),
        error instanceof Error ? error.message : 'invalid_token',
        'QR token is invalid or expired',
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
      return deny(direction, 'subject_inactive', 'Access profile is not active', accessPoint, subject);
    }

    if (!subject.allowedAccessPointClasses.includes(accessPoint.class)) {
      return deny(
        direction,
        'access_point_class_not_allowed',
        'Access point class is not allowed',
        accessPoint,
        subject
      );
    }

    if (!token.accessPointClasses.includes(accessPoint.class)) {
      return deny(
        direction,
        'token_access_point_class_not_allowed',
        'QR token does not allow this access point class',
        accessPoint,
        subject
      );
    }

    if (accessPoint.floorId && !subject.allowedFloorIds.includes(accessPoint.floorId)) {
      return deny(direction, 'floor_not_allowed', 'This floor is not allowed', accessPoint, subject);
    }

    if (accessPoint.floorId && !token.floorIds.includes(accessPoint.floorId)) {
      return deny(
        direction,
        'token_floor_not_allowed',
        'QR token does not allow this floor',
        accessPoint,
        subject
      );
    }

    return allow(direction, subject.status, 'Access granted', accessPoint, subject);
  }

  private scanVisitor(token: VerifiedDisplayToken, accessPoint: AccessPoint): ScanResponse {
    const direction = directionForAccessPoint(accessPoint);
    const pass = this.store.findVisitorPassForTokenSubject(token.subject);

    if (!pass) {
      return deny(direction, 'visitor_pass_not_found', 'Visitor pass was not found', accessPoint);
    }

    const subject = this.store.getSubject(pass.visitorSubjectId);

    if (!subject) {
      return deny(direction, 'visitor_not_found', 'Visitor profile was not found', accessPoint);
    }

    const now = Date.now();

    if (pass.status === 'revoked' || pass.status === 'cancelled') {
      return deny(direction, 'visitor_pass_revoked', 'Visitor pass was revoked', accessPoint, subject);
    }

    if (pass.status === 'exited') {
      return deny(direction, 'visitor_pass_closed', 'Visitor pass is already closed', accessPoint, subject);
    }

    if (now < pass.windowStart.getTime() || now > pass.windowEnd.getTime()) {
      return deny(direction, 'visitor_window_closed', 'Visitor access window is closed', accessPoint, subject);
    }

    if (pass.status === 'scheduled') {
      if (accessPoint.class !== 'MAIN_ENTRY') {
        return deny(
          direction,
          'visitor_must_enter_first',
          'Visitor must enter through the main entrance first',
          accessPoint,
          subject
        );
      }

      this.store.updateVisitorPassStatus(pass.id, 'entered');
      return allow('enter', 'entered', 'Visitor entered', accessPoint, subject);
    }

    if (pass.status === 'entered') {
      if (accessPoint.class === 'EXIT') {
        this.store.updateVisitorPassStatus(pass.id, 'exited');
        return allow('exit', 'exited', 'Visitor exited', accessPoint, subject);
      }

      if (accessPoint.floorId && accessPoint.floorId !== pass.floorId) {
        return deny(direction, 'visitor_floor_not_allowed', 'Visitor floor is not allowed', accessPoint, subject);
      }

      if (accessPoint.class === 'LIFT' || accessPoint.class === 'STAIR_LANDING') {
        return allow('move', 'entered', 'Visitor floor access granted', accessPoint, subject);
      }

      return deny(direction, 'visitor_exit_required', 'Visitor is already inside', accessPoint, subject);
    }

    return deny(direction, `visitor_pass_${pass.status}`, 'Visitor pass is not active', accessPoint, subject);
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
    kind: subject.kind,
    full_name: subject.fullName,
    tenant_name: subject.tenantName,
    floors: subject.allowedFloorIds
  };
}

function displayAccessPoint(accessPoint: AccessPoint) {
  return {
    id: accessPoint.id,
    label: accessPoint.label,
    class: accessPoint.class
  };
}
