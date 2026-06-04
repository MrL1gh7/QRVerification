import { z } from 'zod';

export const currentQrResponseSchema = z.object({
  mode: z.enum([
    'scaffold',
    'operator',
    'tenant_admin',
    'employee',
    'visitor',
    'internal_staff',
    'guard'
  ]),
  step: z.enum(['pending', 'enter', 'exit', 'move', 'expired', 'revoked']),
  expires_at: z.string().nullable(),
  refresh_after_ms: z.number().int().positive().nullable(),
  display: z.object({
    full_name: z.string(),
    job_title: z.string(),
    tenant_name: z.string(),
    floors: z.array(z.string()),
    status: z.string(),
    can_scan: z.boolean()
  }),
  qr_token: z.string().nullable(),
  message: z.string()
});

export type CurrentQrResponse = z.infer<typeof currentQrResponseSchema>;
