import { z } from 'zod';

const telegramUserSchema = z
  .object({
    id: z.number().int(),
    is_bot: z.boolean().optional(),
    first_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional()
  })
  .passthrough();

const telegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.string(),
    first_name: z.string().optional()
  })
  .passthrough();

const telegramEntitySchema = z
  .object({
    offset: z.number().int(),
    length: z.number().int(),
    type: z.string()
  })
  .passthrough();

const telegramWebAppDataSchema = z
  .object({
    data: z.string(),
    button_text: z.string()
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat: telegramChatSchema,
    from: telegramUserSchema.optional(),
    text: z.string().optional(),
    entities: z.array(telegramEntitySchema).optional(),
    web_app_data: telegramWebAppDataSchema.optional()
  })
  .passthrough();

const telegramCallbackQuerySchema = z
  .object({
    id: z.string(),
    from: telegramUserSchema,
    data: z.string().optional(),
    message: telegramMessageSchema.optional()
  })
  .passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional()
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
