import { z } from 'zod';

export const accessEventLogEntrySchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  request_id: z.string(),
  scanner_id: z.string(),
  access_point_id: z.string().optional(),
  access_point_label: z.string().optional(),
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
