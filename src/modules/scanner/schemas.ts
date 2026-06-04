import { z } from 'zod';

export const scanRequestSchema = z.object({
  request_id: z.string().min(1),
  scanner_id: z.string().min(1),
  captured_at: z.string().datetime({ offset: true }),
  token: z.string().min(1)
});

export const scanResponseSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  direction: z.enum(['enter', 'exit', 'move']),
  reason_code: z.string(),
  next_subject_state: z.string(),
  display_message: z.string(),
  subject: z
    .object({
      id: z.string().optional(),
      kind: z.string(),
      full_name: z.string(),
      tenant_name: z.string(),
      floors: z.array(z.string()),
      photo_file_id: z.string().optional(),
      photo_data_url: z.string().optional()
    })
    .optional(),
  access_point: z
    .object({
      id: z.string(),
      label: z.string(),
      class: z.string()
    })
    .optional()
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;
export type ScanResponse = z.infer<typeof scanResponseSchema>;
