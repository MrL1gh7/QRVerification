import { z } from 'zod';

export const subjectKindSchema = z.enum([
  'operator',
  'tenant_admin',
  'employee',
  'visitor',
  'internal_staff',
  'guard'
]);

export const registrationRoleSchema = z.enum([
  'tenant_admin',
  'employee',
  'internal_staff',
  'guard'
]);

export const registrationRequestCreateSchema = z.object({
  full_name: z.string().trim().min(3).max(120),
  requested_role: registrationRoleSchema,
  consent_accepted: z.literal(true),
  photo_data_url: z
    .string()
    .min(1)
    .max(3_000_000)
    .regex(/^data:image\/(png|jpe?g|webp);base64,/i)
});

export const registrationRequestActionParamsSchema = z.object({
  id: z.string().min(1)
});

export const registrationRejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(240).optional()
});

export const userParamsSchema = z.object({
  id: z.string().min(1)
});

export const userRoleUpdateSchema = z.object({
  role: z.enum(['operator', 'tenant_admin', 'employee', 'internal_staff', 'guard'])
});

export const staticVisitorPassCreateSchema = z.object({
  full_name: z.string().trim().min(3).max(120)
});

export const faceVerificationRequestSchema = z.object({
  request_id: z.string().min(1),
  matched: z.boolean()
});

export const accessEventLogEntrySchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  request_id: z.string(),
  scanner_id: z.string(),
  access_point_id: z.string().optional(),
  access_point_label: z.string().optional(),
  subject_id: z.string().optional(),
  subject_name: z.string().optional(),
  subject_kind: z.string().optional(),
  tenant_name: z.string().optional(),
  direction: z.enum(['enter', 'exit', 'move']),
  decision: z.enum(['allow', 'deny']),
  reason_code: z.string(),
  display_message: z.string()
});

export const accessEventLogResponseSchema = z.object({
  events: z.array(accessEventLogEntrySchema)
});
