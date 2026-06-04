import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import type {
  AccessEventLogEntry,
  AccessPoint,
  AccessSubject,
  AccessPointClass,
  SubjectStatus,
  RegistrationRequest,
  RegistrationRequestStatus,
  Scanner,
  SubjectKind,
  VisitorPass,
  VisitorPassStatus
} from './types.js';

export const normalizeUsername = (username?: string): string | undefined => {
  if (!username) {
    return undefined;
  }

  const normalized = username.trim().replace(/^@/, '').toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

type RegistrationRole = Exclude<SubjectKind, 'operator' | 'visitor'>;

type StoreOptions = {
  databasePath?: string;
};

type SqliteRow = Record<string, unknown>;

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFilePath), '../../..');
const DEFAULT_DATABASE_PATH = path.join(projectRoot, 'data', 'access.sqlite');

const PERMANENT_USERS = [
  {
    username: 'Light_epoH',
    kind: 'operator' as const
  }
] as const;

const LEGACY_PERMANENT_USERNAMES = [
  'ta_pri',
  'EbalMamuDurova',
  'l1zzrt',
  'arineyvert',
  'ANDREYYYYY69',
  'Justzritel',
  'wh1plasher',
  'ddmaau',
  'eonri',
  'ShatiCK7975',
  'angelkuzz',
  'nessymoonlight',
  'aalinkaaaaaaaaaaaa',
  'kyssrv',
  'xopizzritochka',
  'annetthen',
  'catherineeest',
  'tmnknkt',
  'vikkffft',
  'denflpv',
  'julia_nichi',
  'tuyalts'
] as const;

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const requiredText = (row: SqliteRow, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Database row is missing text column ${key}`);
  }
  return value;
};

const optionalText = (row: SqliteRow, key: string): string | undefined => {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const boolFromRow = (row: SqliteRow, key: string): boolean => Number(row[key] ?? 0) === 1;

const jsonArrayFromRow = (row: SqliteRow, key: string): string[] => {
  const value = optionalText(row, key);
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const jsonArray = (items: readonly string[]): string => JSON.stringify(items);

const dbText = (value?: string | null): string | null => value ?? null;

const assertSubjectKind = (kind: string): SubjectKind => {
  if (
    kind === 'operator' ||
    kind === 'tenant_admin' ||
    kind === 'employee' ||
    kind === 'visitor' ||
    kind === 'internal_staff' ||
    kind === 'guard'
  ) {
    return kind;
  }

  throw new Error(`Unknown subject kind: ${kind}`);
};

const assertRegistrationRole = (kind: string): RegistrationRole => {
  const subjectKind = assertSubjectKind(kind);
  if (subjectKind === 'operator' || subjectKind === 'visitor') {
    throw new Error(`Invalid registration role: ${kind}`);
  }

  return subjectKind;
};

const assertStatus = (status: string): SubjectStatus => {
  if (status === 'active' || status === 'disabled' || status === 'revoked') {
    return status;
  }

  throw new Error(`Unknown subject status: ${status}`);
};

const assertVisitorPassStatus = (status: string): VisitorPassStatus => {
  if (
    status === 'scheduled' ||
    status === 'entered' ||
    status === 'exited' ||
    status === 'expired' ||
    status === 'revoked' ||
    status === 'cancelled'
  ) {
    return status;
  }

  throw new Error(`Unknown visitor pass status: ${status}`);
};

const assertRegistrationRequestStatus = (status: string): RegistrationRequestStatus => {
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    return status;
  }

  throw new Error(`Unknown registration request status: ${status}`);
};

const assertAccessPointClass = (value: string): AccessPointClass => {
  if (value === 'MAIN_ENTRY' || value === 'LIFT' || value === 'STAIR_LANDING' || value === 'EXIT') {
    return value;
  }

  throw new Error(`Unknown access point class: ${value}`);
};

const accessPointClassesFromRow = (row: SqliteRow, key: string): AccessPointClass[] =>
  jsonArrayFromRow(row, key).map(assertAccessPointClass);

const roleLabel = (kind: SubjectKind): string => {
  switch (kind) {
    case 'operator':
      return 'администратор';
    case 'tenant_admin':
      return 'администратор арендатора';
    case 'internal_staff':
      return 'внутренний персонал';
    case 'guard':
      return 'охранник';
    case 'visitor':
      return 'посетитель';
    case 'employee':
    default:
      return 'сотрудник';
  }
};

const createSubject = (input: {
  id: string;
  kind: SubjectKind;
  username?: string;
  fullName: string;
  photoFileId?: string;
  photoDataUrl?: string;
}): AccessSubject => {
  const isGuard = input.kind === 'guard';
  const isOperator = input.kind === 'operator';
  const isInternal = input.kind === 'internal_staff';
  const isVisitor = input.kind === 'visitor';

  return {
    id: input.id,
    kind: input.kind,
    fullName: input.fullName,
    jobTitle: roleLabel(input.kind),
    tenantName: isOperator || isInternal || isGuard ? 'Управляющая компания' : 'Резидент здания',
    buildingId: 'bldg_1',
    status: 'active',
    allowedFloorIds: isOperator || isInternal || isGuard ? ['f1', 'f2', 'f3', 'f4', 'f5'] : isVisitor ? ['f1'] : ['f2'],
    allowedAccessPointClasses: ['MAIN_ENTRY', 'EXIT'],
    canScan: isOperator || isGuard,
    telegramUsername: input.username,
    photoFileId: input.photoFileId,
    photoDataUrl: input.photoDataUrl
  };
};

export class InMemoryAccessStore {
  private readonly db: DatabaseSync;

  constructor(options: StoreOptions = {}) {
    const databasePath = options.databasePath ?? process.env.ACCESS_DB_PATH ?? DEFAULT_DATABASE_PATH;
    if (databasePath !== ':memory:') {
      const directory = path.dirname(databasePath);
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
      }
    }

    this.db = new DatabaseSync(databasePath);
    this.enablePragmas(databasePath);
    this.migrate();
    this.removeLegacyPermanentUsers();
    this.seedConfiguredUsers();
    this.seedPerimeterAccess();
  }

  findSubjectByTelegramUserId(telegramUserId: number | string): AccessSubject | undefined {
    const row = this.db
      .prepare(
        `SELECT p.*
         FROM telegram_links tl
         JOIN participants p ON p.id = tl.subject_id
         WHERE tl.telegram_user_id = ?`
      )
      .get(String(telegramUserId)) as SqliteRow | undefined;

    return row ? this.rowToSubject(row) : undefined;
  }

  findSubjectByTelegramUsername(username?: string): AccessSubject | undefined {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return undefined;
    }

    const row = this.db
      .prepare('SELECT * FROM participants WHERE telegram_username = ?')
      .get(normalized) as SqliteRow | undefined;

    return row ? this.rowToSubject(row) : undefined;
  }

  findSubjectByTelegramIdentity(telegramUserId?: number | string, username?: string): AccessSubject | undefined {
    if (telegramUserId !== undefined) {
      const linked = this.findSubjectByTelegramUserId(telegramUserId);
      if (linked) {
        return linked;
      }
    }

    const byUsername = this.findSubjectByTelegramUsername(username);
    if (byUsername && telegramUserId !== undefined) {
      this.linkTelegramUser(telegramUserId, byUsername.id, username);
    }

    return byUsername;
  }

  linkTelegramUser(telegramUserId: number | string, subjectId: string, username?: string): void {
    const normalized = normalizeUsername(username);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO telegram_links (telegram_user_id, username, subject_id, linked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           username = excluded.username,
           subject_id = excluded.subject_id,
           linked_at = excluded.linked_at`
      )
      .run(String(telegramUserId), dbText(normalized), subjectId, now);

    if (normalized) {
      this.db
        .prepare('UPDATE participants SET telegram_username = ?, updated_at = ? WHERE id = ?')
        .run(normalized, now, subjectId);
    }
  }

  getSubject(subjectId: string): AccessSubject | undefined {
    const row = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(subjectId) as SqliteRow | undefined;
    return row ? this.rowToSubject(row) : undefined;
  }

  listSubjects(): AccessSubject[] {
    const rows = this.db
      .prepare('SELECT * FROM participants ORDER BY full_name COLLATE NOCASE ASC')
      .all() as SqliteRow[];

    return rows.map((row) => this.rowToSubject(row));
  }

  addOrUpdateUser(input: {
    username: string;
    kind: Exclude<SubjectKind, 'visitor'>;
    fullName?: string;
    photoFileId?: string;
    photoDataUrl?: string;
  }): AccessSubject {
    const normalized = normalizeUsername(input.username);
    if (!normalized) {
      throw new Error('Username is required');
    }

    const existing = this.findSubjectByTelegramUsername(normalized);
    const subject = createSubject({
      id: existing?.id ?? `user_${normalized}`,
      kind: input.kind,
      username: normalized,
      fullName: input.fullName ?? existing?.fullName ?? `@${normalized}`,
      photoFileId: input.photoFileId ?? existing?.photoFileId,
      photoDataUrl: input.photoDataUrl ?? existing?.photoDataUrl
    });

    this.upsertSubject(subject);
    return this.requireSubject(subject.id);
  }

  updateUserRole(username: string, kind: Exclude<SubjectKind, 'visitor'>): AccessSubject | undefined {
    const subject = this.findSubjectByTelegramUsername(username);
    return subject ? this.updateUserRoleById(subject.id, kind) : undefined;
  }

  updateUserRoleById(subjectId: string, kind: Exclude<SubjectKind, 'visitor'>): AccessSubject | undefined {
    const subject = this.getSubject(subjectId);
    if (!subject) {
      return undefined;
    }

    const updated = createSubject({
      id: subject.id,
      kind,
      username: subject.telegramUsername,
      fullName: subject.fullName,
      photoFileId: subject.photoFileId,
      photoDataUrl: subject.photoDataUrl
    });

    this.upsertSubject(updated);
    return this.requireSubject(subject.id);
  }

  deleteUser(username: string): boolean {
    const subject = this.findSubjectByTelegramUsername(username);
    return Boolean(subject && this.deleteUserById(subject.id));
  }

  deleteUserById(subjectId: string): AccessSubject | undefined {
    const subject = this.getSubject(subjectId);
    if (!subject) {
      return undefined;
    }

    this.db.prepare('DELETE FROM telegram_links WHERE subject_id = ?').run(subjectId);
    this.db.prepare('DELETE FROM active_display_jtis WHERE subject_id = ?').run(subjectId);
    this.db.prepare('DELETE FROM participants WHERE id = ?').run(subjectId);
    return subject;
  }

  setSubjectPhoto(subjectId: string, photoFileId: string): AccessSubject | undefined {
    const subject = this.getSubject(subjectId);
    if (!subject) {
      return undefined;
    }

    this.db
      .prepare('UPDATE participants SET photo_file_id = ?, updated_at = ? WHERE id = ?')
      .run(photoFileId, new Date().toISOString(), subjectId);

    return this.requireSubject(subjectId);
  }

  requireSubject(subjectId: string): AccessSubject {
    const subject = this.getSubject(subjectId);
    if (!subject) {
      throw new Error(`Unknown subject: ${subjectId}`);
    }

    return subject;
  }

  createRegistrationRequest(input: {
    telegramUserId: number | string;
    username?: string;
    fullName: string;
    requestedRole: RegistrationRole;
    consentAccepted: boolean;
    photoDataUrl: string;
  }): RegistrationRequest {
    const existingPending = this.findRegistrationRequestByTelegramUserId(input.telegramUserId, 'pending');
    if (existingPending) {
      return existingPending;
    }

    const now = new Date().toISOString();
    const request: RegistrationRequest = {
      id: createId('reg'),
      telegramUserId: String(input.telegramUserId),
      username: normalizeUsername(input.username),
      fullName: input.fullName,
      requestedRole: input.requestedRole,
      consentAccepted: input.consentAccepted,
      photoDataUrl: input.photoDataUrl,
      status: 'pending',
      createdAt: new Date(now)
    };

    this.db
      .prepare(
        `INSERT INTO registration_requests (
          id, telegram_user_id, username, full_name, requested_role, consent_accepted,
          photo_data_url, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.id,
        request.telegramUserId,
        dbText(request.username),
        request.fullName,
        request.requestedRole,
        request.consentAccepted ? 1 : 0,
        request.photoDataUrl,
        request.status,
        now
      );

    return request;
  }

  findRegistrationRequestByTelegramUserId(
    telegramUserId: number | string,
    status?: RegistrationRequestStatus
  ): RegistrationRequest | undefined {
    const row = status
      ? (this.db
          .prepare(
            `SELECT * FROM registration_requests
             WHERE telegram_user_id = ? AND status = ?
             ORDER BY created_at DESC
             LIMIT 1`
          )
          .get(String(telegramUserId), status) as SqliteRow | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM registration_requests
             WHERE telegram_user_id = ?
             ORDER BY created_at DESC
             LIMIT 1`
          )
          .get(String(telegramUserId)) as SqliteRow | undefined);

    return row ? this.rowToRegistrationRequest(row) : undefined;
  }

  listRegistrationRequests(status?: RegistrationRequestStatus): RegistrationRequest[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM registration_requests WHERE status = ? ORDER BY created_at DESC')
          .all(status) as SqliteRow[])
      : (this.db.prepare('SELECT * FROM registration_requests ORDER BY created_at DESC').all() as SqliteRow[]);

    return rows.map((row) => this.rowToRegistrationRequest(row));
  }

  approveRegistrationRequest(
    requestId: string,
    reviewer: AccessSubject
  ): { request: RegistrationRequest; subject: AccessSubject } | undefined {
    const request = this.getRegistrationRequest(requestId);
    if (!request) {
      return undefined;
    }

    if (request.status !== 'pending') {
      return request.subjectId ? { request, subject: this.requireSubject(request.subjectId) } : undefined;
    }

    const subject = createSubject({
      id: `tg_${request.telegramUserId}`,
      kind: request.requestedRole,
      username: request.username,
      fullName: request.fullName,
      photoDataUrl: request.photoDataUrl
    });
    this.upsertSubject(subject);
    this.linkTelegramUser(request.telegramUserId, subject.id, request.username);

    const reviewedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE registration_requests
         SET status = 'approved',
             reviewed_at = ?,
             reviewed_by_subject_id = ?,
             subject_id = ?
         WHERE id = ?`
      )
      .run(reviewedAt, reviewer.id, subject.id, requestId);

    const approvedRequest = this.getRegistrationRequest(requestId);
    if (!approvedRequest) {
      return undefined;
    }

    return {
      request: approvedRequest,
      subject: this.requireSubject(subject.id)
    };
  }

  rejectRegistrationRequest(
    requestId: string,
    reviewer: AccessSubject,
    reason?: string
  ): RegistrationRequest | undefined {
    const request = this.getRegistrationRequest(requestId);
    if (!request || request.status !== 'pending') {
      return request;
    }

    const reviewedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE registration_requests
         SET status = 'rejected',
             reviewed_at = ?,
             reviewed_by_subject_id = ?,
             rejection_reason = ?
         WHERE id = ?`
      )
      .run(reviewedAt, reviewer.id, dbText(reason), requestId);

    return this.getRegistrationRequest(requestId);
  }

  findSubjectForTokenSubject(tokenSubject: string): AccessSubject | undefined {
    if (tokenSubject.startsWith('qr_session:')) {
      return this.getSubject(tokenSubject.replace('qr_session:', ''));
    }

    if (tokenSubject.startsWith('user:')) {
      return this.getSubject(tokenSubject.replace('user:', ''));
    }

    return undefined;
  }

  findVisitorPassForTokenSubject(tokenSubject: string): VisitorPass | undefined {
    if (!tokenSubject.startsWith('visitor_pass:')) {
      return undefined;
    }

    return this.getVisitorPass(tokenSubject.replace('visitor_pass:', ''));
  }

  getVisitorPass(passId: string): VisitorPass | undefined {
    const row = this.db.prepare('SELECT * FROM visitor_passes WHERE id = ?').get(passId) as SqliteRow | undefined;
    return row ? this.rowToVisitorPass(row) : undefined;
  }

  updateVisitorPassStatus(passId: string, status: VisitorPassStatus): VisitorPass | undefined {
    this.db.prepare('UPDATE visitor_passes SET status = ? WHERE id = ?').run(status, passId);
    return this.getVisitorPass(passId);
  }

  createStaticVisitorPass(input: {
    visitorUsername?: string;
    visitorFullName?: string;
    createdBy: AccessSubject;
    validHours?: number;
  }): { pass: VisitorPass; visitorSubject: AccessSubject } {
    const normalized = normalizeUsername(input.visitorUsername);
    const visitorId = normalized ? `visitor_${normalized}` : createId('visitor');
    const fullName = input.visitorFullName ?? (normalized ? `@${normalized}` : 'Посетитель');
    const visitor = createSubject({
      id: visitorId,
      kind: 'visitor',
      username: normalized,
      fullName
    });
    visitor.jobTitle = 'посетитель';
    visitor.tenantName = input.createdBy.tenantName;
    visitor.allowedFloorIds = input.createdBy.allowedFloorIds.length > 0 ? input.createdBy.allowedFloorIds : ['f1'];

    this.upsertSubject(visitor);

    const now = new Date();
    const validHours = input.validHours ?? 24;
    const pass: VisitorPass = {
      id: createId('vp'),
      visitorSubjectId: visitor.id,
      buildingId: 'bldg_1',
      floorId: visitor.allowedFloorIds[0] ?? 'f1',
      windowStart: now,
      windowEnd: new Date(now.getTime() + validHours * 60 * 60 * 1000),
      status: 'scheduled',
      visitorUsername: normalized,
      visitorFullName: fullName,
      createdBySubjectId: input.createdBy.id,
      createdAt: now
    };

    this.db
      .prepare(
        `INSERT INTO visitor_passes (
          id, visitor_subject_id, building_id, floor_id, window_start, window_end,
          status, visitor_username, visitor_full_name, created_by_subject_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pass.id,
        pass.visitorSubjectId,
        pass.buildingId,
        pass.floorId,
        pass.windowStart.toISOString(),
        pass.windowEnd.toISOString(),
        pass.status,
        dbText(pass.visitorUsername),
        fullName,
        input.createdBy.id,
        now.toISOString()
      );

    return { pass, visitorSubject: this.requireSubject(visitor.id) };
  }

  getScanner(scannerId: string): Scanner | undefined {
    const row = this.db.prepare('SELECT * FROM scanners WHERE id = ?').get(scannerId) as SqliteRow | undefined;
    return row ? this.rowToScanner(row) : undefined;
  }

  getAccessPoint(accessPointId: string): AccessPoint | undefined {
    const row = this.db.prepare('SELECT * FROM access_points WHERE id = ?').get(accessPointId) as
      | SqliteRow
      | undefined;
    return row ? this.rowToAccessPoint(row) : undefined;
  }

  getAccessPointForScanner(scannerId: string): AccessPoint | undefined {
    const row = this.db
      .prepare(
        `SELECT ap.*
         FROM scanners sc
         JOIN access_points ap ON ap.id = sc.access_point_id
         WHERE sc.id = ?`
      )
      .get(scannerId) as SqliteRow | undefined;

    return row ? this.rowToAccessPoint(row) : undefined;
  }

  getScanners(): Scanner[] {
    const rows = this.db.prepare('SELECT * FROM scanners ORDER BY label COLLATE NOCASE ASC').all() as SqliteRow[];
    return rows.map((row) => this.rowToScanner(row));
  }

  consumeJti(jti: string, expiresAtEpochSeconds: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare('DELETE FROM consumed_jtis WHERE expires_at <= ?').run(now);

    const existing = this.db.prepare('SELECT jti FROM consumed_jtis WHERE jti = ?').get(jti) as SqliteRow | undefined;
    if (existing) {
      return false;
    }

    this.db.prepare('INSERT INTO consumed_jtis (jti, expires_at) VALUES (?, ?)').run(jti, expiresAtEpochSeconds);
    return true;
  }

  setActiveDisplayJti(subjectId: string, jti: string): void {
    this.db
      .prepare(
        `INSERT INTO active_display_jtis (subject_id, jti)
         VALUES (?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET jti = excluded.jti`
      )
      .run(subjectId, jti);
  }

  isActiveDisplayJti(subjectId: string, jti: string): boolean {
    const row = this.db
      .prepare('SELECT jti FROM active_display_jtis WHERE subject_id = ?')
      .get(subjectId) as SqliteRow | undefined;

    return !row || optionalText(row, 'jti') === jti;
  }

  appendAccessEvent(event: Omit<AccessEventLogEntry, 'id' | 'occurredAt'> & { occurredAt?: Date }): AccessEventLogEntry {
    const entry: AccessEventLogEntry = {
      id: createId('evt'),
      occurredAt: event.occurredAt ?? new Date(),
      requestId: event.requestId,
      scannerId: event.scannerId,
      accessPointId: event.accessPointId,
      accessPointLabel: event.accessPointLabel,
      subjectId: event.subjectId,
      subjectName: event.subjectName,
      subjectKind: event.subjectKind,
      tenantName: event.tenantName,
      direction: event.direction,
      decision: event.decision,
      reasonCode: event.reasonCode,
      displayMessage: event.displayMessage
    };

    this.db
      .prepare(
        `INSERT INTO access_events (
          id, occurred_at, request_id, scanner_id, access_point_id, access_point_label,
          subject_id, subject_name, subject_kind, tenant_name, direction, decision,
          reason_code, display_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.occurredAt.toISOString(),
        dbText(entry.requestId),
        dbText(entry.scannerId),
        dbText(entry.accessPointId),
        dbText(entry.accessPointLabel),
        dbText(entry.subjectId),
        dbText(entry.subjectName),
        dbText(entry.subjectKind),
        dbText(entry.tenantName),
        entry.direction,
        entry.decision,
        entry.reasonCode,
        entry.displayMessage
      );

    return entry;
  }

  listAccessEvents(limit = 50): AccessEventLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM access_events ORDER BY occurred_at DESC LIMIT ?')
      .all(limit) as SqliteRow[];

    return rows.map((row) => this.rowToAccessEvent(row));
  }

  markAccessEventFaceVerification(
    requestId: string,
    matched: boolean
  ): AccessEventLogEntry | undefined {
    const event = this.getAccessEventByRequestId(requestId);
    if (!event) {
      return undefined;
    }

    if (!matched) {
      this.rollbackVisitorPassIfNeeded(event);
    }

    this.db
      .prepare(
        `UPDATE access_events
         SET decision = ?,
             reason_code = ?,
             display_message = ?
         WHERE request_id = ?`
      )
      .run(
        matched ? 'allow' : 'deny',
        matched ? 'face_verified' : 'face_mismatch',
        matched ? 'Лицо подтверждено, проход засчитан' : 'Лицо не совпадает, проход отменён',
        requestId
      );

    return this.getAccessEventByRequestId(requestId);
  }

  private enablePragmas(databasePath: string): void {
    this.db.exec('PRAGMA foreign_keys = ON;');

    if (databasePath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        full_name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        tenant_name TEXT NOT NULL,
        building_id TEXT NOT NULL,
        status TEXT NOT NULL,
        allowed_floor_ids TEXT NOT NULL,
        allowed_access_point_classes TEXT NOT NULL,
        can_scan INTEGER NOT NULL DEFAULT 0,
        visitor_pass_id TEXT,
        telegram_username TEXT UNIQUE,
        photo_file_id TEXT,
        photo_data_url TEXT,
        registered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_links (
        telegram_user_id TEXT PRIMARY KEY,
        username TEXT,
        subject_id TEXT NOT NULL,
        linked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registration_requests (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        username TEXT,
        full_name TEXT NOT NULL,
        requested_role TEXT NOT NULL,
        consent_accepted INTEGER NOT NULL,
        photo_data_url TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by_subject_id TEXT,
        rejection_reason TEXT,
        subject_id TEXT
      );

      CREATE TABLE IF NOT EXISTS visitor_passes (
        id TEXT PRIMARY KEY,
        visitor_subject_id TEXT NOT NULL,
        building_id TEXT NOT NULL,
        floor_id TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        status TEXT NOT NULL,
        visitor_username TEXT,
        visitor_full_name TEXT NOT NULL,
        created_by_subject_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_points (
        id TEXT PRIMARY KEY,
        building_id TEXT NOT NULL,
        floor_id TEXT,
        label TEXT NOT NULL,
        class TEXT NOT NULL,
        direction_mode TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scanners (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        access_point_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS access_events (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        request_id TEXT,
        scanner_id TEXT,
        access_point_id TEXT,
        access_point_label TEXT,
        subject_id TEXT,
        subject_name TEXT,
        subject_kind TEXT,
        tenant_name TEXT,
        direction TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        display_message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consumed_jtis (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_display_jtis (
        subject_id TEXT PRIMARY KEY,
        jti TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_participants_username ON participants (telegram_username);
      CREATE INDEX IF NOT EXISTS idx_access_events_occurred_at ON access_events (occurred_at);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests (status);
    `);
  }

  private seedConfiguredUsers(): void {
    PERMANENT_USERS.forEach((user) => {
      const normalized = normalizeUsername(user.username);
      if (!normalized || this.findSubjectByTelegramUsername(normalized)) {
        return;
      }

      const subject = createSubject({
        id: `user_${normalized}`,
        kind: user.kind,
        username: normalized,
        fullName: `@${user.username}`
      });

      this.upsertSubject(subject);
    });
  }

  private removeLegacyPermanentUsers(): void {
    LEGACY_PERMANENT_USERNAMES.forEach((username) => {
      const normalized = normalizeUsername(username);
      if (!normalized) {
        return;
      }

      const legacySubjectId = `user_${normalized}`;
      this.deleteUserById(legacySubjectId);
    });
  }

  private seedPerimeterAccess(): void {
    const accessPoints: AccessPoint[] = [
      {
        id: 'ap_main_entry',
        buildingId: 'bldg_1',
        label: 'Главный вход',
        class: 'MAIN_ENTRY',
        directionMode: 'in'
      },
      {
        id: 'ap_main_exit',
        buildingId: 'bldg_1',
        label: 'Главный выход',
        class: 'EXIT',
        directionMode: 'out'
      }
    ];

    accessPoints.forEach((point) => {
      this.db
        .prepare(
          `INSERT INTO access_points (id, building_id, floor_id, label, class, direction_mode)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             class = excluded.class,
             direction_mode = excluded.direction_mode`
        )
        .run(point.id, point.buildingId, dbText(point.floorId), point.label, point.class, point.directionMode);
    });

    const scanners: Scanner[] = [
      { id: 'scn_main_entry', label: 'Скан входа', accessPointId: 'ap_main_entry', active: true },
      { id: 'scn_exit', label: 'Скан выхода', accessPointId: 'ap_main_exit', active: true }
    ];

    scanners.forEach((scanner) => {
      this.db
        .prepare(
          `INSERT INTO scanners (id, label, access_point_id, active)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             access_point_id = excluded.access_point_id,
             active = excluded.active`
        )
        .run(scanner.id, scanner.label, scanner.accessPointId, scanner.active ? 1 : 0);
    });
  }

  private upsertSubject(subject: AccessSubject): void {
    const now = new Date().toISOString();
    const existing = this.getSubject(subject.id);
    const registeredAt = existing ? this.getRegisteredAt(subject.id) : now;

    this.db
      .prepare(
        `INSERT INTO participants (
          id, kind, full_name, job_title, tenant_name, building_id, status,
          allowed_floor_ids, allowed_access_point_classes, can_scan, visitor_pass_id,
          telegram_username, photo_file_id, photo_data_url, registered_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          full_name = excluded.full_name,
          job_title = excluded.job_title,
          tenant_name = excluded.tenant_name,
          building_id = excluded.building_id,
          status = excluded.status,
          allowed_floor_ids = excluded.allowed_floor_ids,
          allowed_access_point_classes = excluded.allowed_access_point_classes,
          can_scan = excluded.can_scan,
          visitor_pass_id = excluded.visitor_pass_id,
          telegram_username = excluded.telegram_username,
          photo_file_id = excluded.photo_file_id,
          photo_data_url = excluded.photo_data_url,
          updated_at = excluded.updated_at`
      )
      .run(
        subject.id,
        subject.kind,
        subject.fullName,
        subject.jobTitle,
        subject.tenantName,
        subject.buildingId,
        subject.status,
        jsonArray(subject.allowedFloorIds),
        jsonArray(subject.allowedAccessPointClasses),
        subject.canScan ? 1 : 0,
        dbText(subject.visitorPassId),
        dbText(normalizeUsername(subject.telegramUsername)),
        dbText(subject.photoFileId),
        dbText(subject.photoDataUrl),
        registeredAt,
        now
      );
  }

  private getRegisteredAt(subjectId: string): string {
    const row = this.db.prepare('SELECT registered_at FROM participants WHERE id = ?').get(subjectId) as
      | SqliteRow
      | undefined;
    return optionalText(row ?? {}, 'registered_at') ?? new Date().toISOString();
  }

  private getRegistrationRequest(requestId: string): RegistrationRequest | undefined {
    const row = this.db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(requestId) as
      | SqliteRow
      | undefined;
    return row ? this.rowToRegistrationRequest(row) : undefined;
  }

  private getAccessEventByRequestId(requestId: string): AccessEventLogEntry | undefined {
    const row = this.db.prepare('SELECT * FROM access_events WHERE request_id = ?').get(requestId) as
      | SqliteRow
      | undefined;
    return row ? this.rowToAccessEvent(row) : undefined;
  }

  private rollbackVisitorPassIfNeeded(event: AccessEventLogEntry): void {
    if (event.subjectKind !== 'visitor' || !event.subjectId) {
      return;
    }

    const pass = this.findVisitorPassByVisitorSubjectId(event.subjectId);
    if (!pass) {
      return;
    }

    if (event.direction === 'enter' && pass.status === 'entered') {
      this.updateVisitorPassStatus(pass.id, 'scheduled');
      return;
    }

    if (event.direction === 'exit' && pass.status === 'exited') {
      this.updateVisitorPassStatus(pass.id, 'entered');
    }
  }

  private findVisitorPassByVisitorSubjectId(visitorSubjectId: string): VisitorPass | undefined {
    const row = this.db
      .prepare(
        `SELECT *
         FROM visitor_passes
         WHERE visitor_subject_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(visitorSubjectId) as SqliteRow | undefined;

    return row ? this.rowToVisitorPass(row) : undefined;
  }

  private rowToSubject(row: SqliteRow): AccessSubject {
    return {
      id: requiredText(row, 'id'),
      kind: assertSubjectKind(requiredText(row, 'kind')),
      fullName: requiredText(row, 'full_name'),
      jobTitle: requiredText(row, 'job_title'),
      tenantName: requiredText(row, 'tenant_name'),
      buildingId: requiredText(row, 'building_id'),
      status: assertStatus(requiredText(row, 'status')),
      allowedFloorIds: jsonArrayFromRow(row, 'allowed_floor_ids'),
      allowedAccessPointClasses: accessPointClassesFromRow(row, 'allowed_access_point_classes'),
      canScan: boolFromRow(row, 'can_scan'),
      visitorPassId: optionalText(row, 'visitor_pass_id'),
      telegramUsername: optionalText(row, 'telegram_username'),
      photoFileId: optionalText(row, 'photo_file_id'),
      photoDataUrl: optionalText(row, 'photo_data_url')
    };
  }

  private rowToRegistrationRequest(row: SqliteRow): RegistrationRequest {
    return {
      id: requiredText(row, 'id'),
      telegramUserId: requiredText(row, 'telegram_user_id'),
      username: optionalText(row, 'username'),
      fullName: requiredText(row, 'full_name'),
      requestedRole: assertRegistrationRole(requiredText(row, 'requested_role')),
      consentAccepted: boolFromRow(row, 'consent_accepted'),
      photoDataUrl: requiredText(row, 'photo_data_url'),
      status: assertRegistrationRequestStatus(requiredText(row, 'status')),
      createdAt: new Date(requiredText(row, 'created_at')),
      reviewedAt: optionalText(row, 'reviewed_at') ? new Date(requiredText(row, 'reviewed_at')) : undefined,
      reviewedBySubjectId: optionalText(row, 'reviewed_by_subject_id'),
      rejectionReason: optionalText(row, 'rejection_reason'),
      subjectId: optionalText(row, 'subject_id')
    };
  }

  private rowToVisitorPass(row: SqliteRow): VisitorPass {
    return {
      id: requiredText(row, 'id'),
      visitorSubjectId: requiredText(row, 'visitor_subject_id'),
      buildingId: requiredText(row, 'building_id'),
      floorId: requiredText(row, 'floor_id'),
      windowStart: new Date(requiredText(row, 'window_start')),
      windowEnd: new Date(requiredText(row, 'window_end')),
      status: assertVisitorPassStatus(requiredText(row, 'status')),
      visitorUsername: optionalText(row, 'visitor_username'),
      visitorFullName: requiredText(row, 'visitor_full_name'),
      createdBySubjectId: requiredText(row, 'created_by_subject_id'),
      createdAt: new Date(requiredText(row, 'created_at'))
    };
  }

  private rowToAccessPoint(row: SqliteRow): AccessPoint {
    return {
      id: requiredText(row, 'id'),
      buildingId: requiredText(row, 'building_id'),
      floorId: optionalText(row, 'floor_id'),
      label: requiredText(row, 'label'),
      class: requiredText(row, 'class') as AccessPoint['class'],
      directionMode: requiredText(row, 'direction_mode') as AccessPoint['directionMode']
    };
  }

  private rowToScanner(row: SqliteRow): Scanner {
    return {
      id: requiredText(row, 'id'),
      label: requiredText(row, 'label'),
      accessPointId: requiredText(row, 'access_point_id'),
      active: boolFromRow(row, 'active')
    };
  }

  private rowToAccessEvent(row: SqliteRow): AccessEventLogEntry {
    return {
      id: requiredText(row, 'id'),
      occurredAt: new Date(requiredText(row, 'occurred_at')),
      requestId: requiredText(row, 'request_id'),
      scannerId: requiredText(row, 'scanner_id'),
      accessPointId: optionalText(row, 'access_point_id'),
      accessPointLabel: optionalText(row, 'access_point_label'),
      subjectId: optionalText(row, 'subject_id'),
      subjectName: optionalText(row, 'subject_name'),
      subjectKind: optionalText(row, 'subject_kind') ? assertSubjectKind(requiredText(row, 'subject_kind')) : undefined,
      tenantName: optionalText(row, 'tenant_name'),
      direction: requiredText(row, 'direction') as AccessEventLogEntry['direction'],
      decision: requiredText(row, 'decision') as AccessEventLogEntry['decision'],
      reasonCode: requiredText(row, 'reason_code'),
      displayMessage: requiredText(row, 'display_message')
    };
  }
}
