import type { ChatMessage } from '../generated/prisma/client';

export type MessageDto = {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  status: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export function toMessageDto(message: ChatMessage): MessageDto {
  return {
    id: message.id,
    thread_id: message.threadId,
    sender_id: message.senderId,
    content: message.content,
    message_type: message.messageType,
    status: message.status,
    edited_at: message.editedAt?.toISOString() ?? null,
    deleted_at: message.deletedAt?.toISOString() ?? null,
    created_at: message.createdAt.toISOString(),
    updated_at: message.updatedAt.toISOString(),
  };
}
