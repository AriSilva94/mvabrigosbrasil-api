import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 5000;

export const messageContentSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export const blockSchema = z.object({
  blocked_id: z.uuid(),
  reason: z
    .string()
    .nullish()
    .transform((value) => value?.slice(0, 500) ?? null),
});

export const reportSchema = z.object({
  reported_user_id: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
  thread_id: z.uuid().nullish(),
  message_id: z.uuid().nullish(),
});
