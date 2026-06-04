export type SubjectKind =
  | 'operator'
  | 'tenant_admin'
  | 'employee'
  | 'visitor'
  | 'internal_staff'
  | 'guard';

export type SubjectStatus = 'active' | 'disabled' | 'revoked';
export type RegistrationRequestStatus = 'pending' | 'approved' | 'rejected';

export type AccessPointClass = 'MAIN_ENTRY' | 'LIFT' | 'STAIR_LANDING' | 'EXIT';

export type DirectionMode = 'in' | 'out' | 'auto';

export type AccessStep = 'enter' | 'exit' | 'move';

export type VisitorPassStatus =
  | 'scheduled'
  | 'entered'
  | 'exited'
  | 'expired'
  | 'revoked'
  | 'cancelled';

export interface AccessSubject {
  id: string;
  kind: SubjectKind;
  fullName: string;
  jobTitle: string;
  tenantName: string;
  buildingId: string;
  status: SubjectStatus;
  allowedFloorIds: string[];
  allowedAccessPointClasses: AccessPointClass[];
  canScan: boolean;
  visitorPassId?: string;
  telegramUsername?: string;
  photoFileId?: string;
  photoDataUrl?: string;
  registeredAt?: Date;
}

export interface AccessPoint {
  id: string;
  buildingId: string;
  floorId?: string;
  label: string;
  class: AccessPointClass;
  directionMode: DirectionMode;
}

export interface Scanner {
  id: string;
  label: string;
  accessPointId: string;
  active: boolean;
}

export interface VisitorPass {
  id: string;
  visitorSubjectId: string;
  buildingId: string;
  floorId: string;
  windowStart: Date;
  windowEnd: Date;
  status: VisitorPassStatus;
  visitorUsername?: string;
  visitorFullName?: string;
  createdBySubjectId?: string;
  createdAt?: Date;
}

export interface TelegramLink {
  telegramUserId: string;
  username?: string;
  subjectId: string;
  linkedAt: Date;
}

export interface RegistrationRequest {
  id: string;
  telegramUserId: string;
  username?: string;
  fullName: string;
  requestedRole: Exclude<SubjectKind, 'operator' | 'visitor'>;
  consentAccepted: boolean;
  photoDataUrl: string;
  status: RegistrationRequestStatus;
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBySubjectId?: string;
  rejectionReason?: string;
  subjectId?: string;
}

export interface AccessEventLogEntry {
  id: string;
  occurredAt: Date;
  requestId: string;
  scannerId: string;
  accessPointId?: string;
  accessPointLabel?: string;
  subjectId?: string;
  subjectName?: string;
  subjectKind?: SubjectKind;
  tenantName?: string;
  direction: AccessStep;
  decision: 'allow' | 'deny';
  reasonCode: string;
  displayMessage: string;
}
