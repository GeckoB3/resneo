import { z } from 'zod';

/** POST /api/venue/assistant body (Docs/help-assistant-plan.md, 3.2). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_MESSAGES = 20;

export const assistantRequestSchema = z
  .object({
    conversationId: z.string().regex(UUID, 'conversationId must be a uuid').optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1, 'Message is empty').max(MAX_MESSAGE_CHARS, `Messages are limited to ${MAX_MESSAGE_CHARS} characters`),
        }),
      )
      .min(1)
      .max(MAX_MESSAGES),
    client: z.enum(['web', 'app']).optional(),
    page: z
      .string()
      .max(200)
      .regex(/^\/[^\s?#]*$/, 'page must be a pathname')
      .optional(),
  })
  .refine((body) => body.messages[body.messages.length - 1]?.role === 'user', {
    message: 'The last message must be from the user',
    path: ['messages'],
  });

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

export const assistantFeedbackSchema = z.object({
  messageId: z.string().regex(UUID, 'messageId must be a uuid'),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(500).optional(),
});

export type AssistantFeedbackRequest = z.infer<typeof assistantFeedbackSchema>;
