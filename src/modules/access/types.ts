export type SubjectKind =
  | 'operator'
  | 'tenant_admin'
  | 'employee'
  | 'visitor'
  | 'internal_staff';

export type SubjectStatus = 'active' | 'disabled' | 'revoked';

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
}

export interface TelegramLink {
  telegramUserId: string;
  subjectId: string;
  linkedAt: Date;
}
