import type {
  AccessEventLogEntry,
  AccessPoint,
  AccessPointClass,
  AccessSubject,
  Scanner,
  TelegramLink,
  VisitorPass,
  VisitorPassStatus
} from './types.js';

const BUILDING_ID = 'bldg_1';

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1_000);
}

export class InMemoryAccessStore {
  private readonly subjects = new Map<string, AccessSubject>();
  private readonly visitorPasses = new Map<string, VisitorPass>();
  private readonly accessPoints = new Map<string, AccessPoint>();
  private readonly scanners = new Map<string, Scanner>();
  private readonly telegramLinks = new Map<string, TelegramLink>();
  private readonly consumedJtis = new Map<string, number>();
  private readonly accessEvents: AccessEventLogEntry[] = [];

  constructor() {
    this.seedDemoData();
  }

  findSubjectByTelegramUserId(telegramUserId: string) {
    const link = this.telegramLinks.get(telegramUserId);
    return link ? this.subjects.get(link.subjectId) : undefined;
  }

  linkTelegramUser(telegramUserId: string, subjectId: string) {
    const subject = this.requireSubject(subjectId);

    this.telegramLinks.set(telegramUserId, {
      telegramUserId,
      subjectId: subject.id,
      linkedAt: new Date()
    });

    return subject;
  }

  getDemoSubjects() {
    return Array.from(this.subjects.values());
  }

  getSubject(subjectId: string) {
    return this.subjects.get(subjectId);
  }

  requireSubject(subjectId: string) {
    const subject = this.subjects.get(subjectId);

    if (!subject) {
      throw new Error(`Unknown access subject: ${subjectId}`);
    }

    return subject;
  }

  findSubjectForTokenSubject(tokenSubject: string) {
    if (!tokenSubject.startsWith('user:')) {
      return undefined;
    }

    return this.subjects.get(tokenSubject.slice('user:'.length));
  }

  findVisitorPassForTokenSubject(tokenSubject: string) {
    if (!tokenSubject.startsWith('visitor_pass:')) {
      return undefined;
    }

    return this.visitorPasses.get(tokenSubject.slice('visitor_pass:'.length));
  }

  getVisitorPass(passId: string) {
    return this.visitorPasses.get(passId);
  }

  updateVisitorPassStatus(passId: string, status: VisitorPassStatus) {
    const pass = this.visitorPasses.get(passId);

    if (!pass) {
      return undefined;
    }

    pass.status = status;
    return pass;
  }

  getScanner(scannerId: string) {
    return this.scanners.get(scannerId);
  }

  getAccessPoint(accessPointId: string) {
    return this.accessPoints.get(accessPointId);
  }

  getAccessPointForScanner(scannerId: string) {
    const scanner = this.scanners.get(scannerId);

    if (!scanner || !scanner.active) {
      return undefined;
    }

    return this.accessPoints.get(scanner.accessPointId);
  }

  getScanners() {
    return Array.from(this.scanners.values()).map((scanner) => ({
      ...scanner,
      accessPoint: this.accessPoints.get(scanner.accessPointId)
    }));
  }

  consumeJti(jti: string, expiresAtEpochSeconds: number) {
    this.evictExpiredJtis();

    if (this.consumedJtis.has(jti)) {
      return false;
    }

    this.consumedJtis.set(jti, expiresAtEpochSeconds);
    return true;
  }

  resetDemoVisitorPass() {
    const pass = this.visitorPasses.get('vp_demo_visit');

    if (!pass) {
      return;
    }

    pass.status = 'scheduled';
    pass.windowStart = hoursFromNow(-1);
    pass.windowEnd = hoursFromNow(8);
  }

  appendAccessEvent(
    event: Omit<AccessEventLogEntry, 'id' | 'occurredAt'>
  ): AccessEventLogEntry {
    const entry: AccessEventLogEntry = {
      id: `evt_${this.accessEvents.length + 1}`,
      occurredAt: new Date(),
      ...event
    };

    this.accessEvents.unshift(entry);
    this.accessEvents.splice(100);

    return entry;
  }

  listAccessEvents(limit = 50) {
    return this.accessEvents.slice(0, limit);
  }

  private evictExpiredJtis() {
    const now = Math.floor(Date.now() / 1_000);

    for (const [jti, expiresAt] of this.consumedJtis.entries()) {
      if (expiresAt <= now) {
        this.consumedJtis.delete(jti);
      }
    }
  }

  private seedDemoData() {
    const accessPointClasses: AccessPointClass[] = [
      'MAIN_ENTRY',
      'LIFT',
      'STAIR_LANDING',
      'EXIT'
    ];

    const seedSubjects: AccessSubject[] = [
      {
        id: 'demo_operator',
        kind: 'operator',
        fullName: 'Operator Demo',
        jobTitle: 'Security operator',
        tenantName: 'Managing company',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: true
      },
      {
        id: 'demo_tenant_admin',
        kind: 'tenant_admin',
        fullName: 'Tenant Admin Demo',
        jobTitle: 'Office manager',
        tenantName: 'Tenant Alpha',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f3'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: true
      },
      {
        id: 'demo_employee_f3',
        kind: 'employee',
        fullName: 'Employee Demo',
        jobTitle: 'Engineer',
        tenantName: 'Tenant Alpha',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f3'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: false
      },
      {
        id: 'demo_employee_f2',
        kind: 'employee',
        fullName: 'Employee Floor 2',
        jobTitle: 'Accountant',
        tenantName: 'Tenant Beta',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f2'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: false
      },
      {
        id: 'demo_staff',
        kind: 'internal_staff',
        fullName: 'Internal Staff Demo',
        jobTitle: 'Maintenance',
        tenantName: 'Managing company',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: true
      },
      {
        id: 'demo_visitor',
        kind: 'visitor',
        fullName: 'Visitor Demo',
        jobTitle: 'Visitor',
        tenantName: 'Tenant Alpha',
        buildingId: BUILDING_ID,
        status: 'active',
        allowedFloorIds: ['f3'],
        allowedAccessPointClasses: accessPointClasses,
        canScan: false,
        visitorPassId: 'vp_demo_visit'
      }
    ];

    for (const subject of seedSubjects) {
      this.subjects.set(subject.id, subject);
    }

    this.visitorPasses.set('vp_demo_visit', {
      id: 'vp_demo_visit',
      visitorSubjectId: 'demo_visitor',
      buildingId: BUILDING_ID,
      floorId: 'f3',
      windowStart: hoursFromNow(-1),
      windowEnd: hoursFromNow(8),
      status: 'scheduled'
    });

    const accessPoints: AccessPoint[] = [
      {
        id: 'ap_main_entry',
        buildingId: BUILDING_ID,
        label: 'Main entrance',
        class: 'MAIN_ENTRY',
        directionMode: 'in'
      },
      {
        id: 'ap_exit',
        buildingId: BUILDING_ID,
        label: 'Exit',
        class: 'EXIT',
        directionMode: 'out'
      },
      {
        id: 'ap_lift_f2',
        buildingId: BUILDING_ID,
        floorId: 'f2',
        label: 'Lift to floor 2',
        class: 'LIFT',
        directionMode: 'auto'
      },
      {
        id: 'ap_lift_f3',
        buildingId: BUILDING_ID,
        floorId: 'f3',
        label: 'Lift to floor 3',
        class: 'LIFT',
        directionMode: 'auto'
      },
      {
        id: 'ap_stair_f3',
        buildingId: BUILDING_ID,
        floorId: 'f3',
        label: 'Stair landing floor 3',
        class: 'STAIR_LANDING',
        directionMode: 'auto'
      }
    ];

    for (const accessPoint of accessPoints) {
      this.accessPoints.set(accessPoint.id, accessPoint);
    }

    const scanners: Scanner[] = [
      {
        id: 'scn_main_entry',
        label: 'Main entrance scanner',
        accessPointId: 'ap_main_entry',
        active: true
      },
      {
        id: 'scn_exit',
        label: 'Exit scanner',
        accessPointId: 'ap_exit',
        active: true
      },
      {
        id: 'scn_lift_f2',
        label: 'Lift floor 2 scanner',
        accessPointId: 'ap_lift_f2',
        active: true
      },
      {
        id: 'scn_lift_f3',
        label: 'Lift floor 3 scanner',
        accessPointId: 'ap_lift_f3',
        active: true
      },
      {
        id: 'scn_stair_f3',
        label: 'Stair floor 3 scanner',
        accessPointId: 'ap_stair_f3',
        active: true
      }
    ];

    for (const scanner of scanners) {
      this.scanners.set(scanner.id, scanner);
    }
  }
}
