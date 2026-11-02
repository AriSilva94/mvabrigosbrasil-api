import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 5000;

export const messageContentSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
