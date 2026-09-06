import OpenAI from 'openai';
import type { AssistantChatMessage } from './prompt';

/**
 * One streaming chat completion for Ask ResNeo (Docs/help-assistant-plan.md, 3.1 and 3.7).
 *
 * Deliberately model-agnostic so a model swap is only an env edit: no `temperature` or
 * other sampling parameters (the GPT-5 family rejects them; the import client learned this
 * the hard way), a plain text prompt, `max_completion_tokens` as a ceiling only, and usage
 * treated as optional. The import tool's `runImportAiJson` is JSON-only and non-streaming,
 * so it is not reused; the three conventions it established are copied: a client timeout,
 * bounded retries, and the response body in the error log.
 */

export const ASSISTANT_TIMEOUT_MS = 45_000;
export const ASSISTANT_MAX_RETRIES = 1;
export const ASSISTANT_MAX_OUTPUT_TOKENS = 1200;

export interface AssistantUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export interface AssistantStreamResult {
  text: string;
  usage: AssistantUsage | null;
  finishReason: string | null;
}

export interface AssistantStreamParams {
  model: string;
  messages: AssistantChatMessage[];
  onToken: (token: string) => void;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export function assistantApiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export async function streamAssistantCompletion(params: AssistantStreamParams): Promise<AssistantStreamResult> {
  const apiKey = assistantApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const openai = new OpenAI({ apiKey, timeout: ASSISTANT_TIMEOUT_MS, maxRetries: ASSISTANT_MAX_RETRIES });

  const stream = await openai.chat.completions.create(
    {
      model: params.model,
      messages: params.messages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: params.maxOutputTokens ?? ASSISTANT_MAX_OUTPUT_TOKENS,
    },
    { signal: params.signal },
  );

  let text = '';
  let usage: AssistantUsage | null = null;
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const token = choice?.delta?.content;
    if (token) {
      text += token;
      params.onToken(token);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens ?? null,
        cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? null,
        outputTokens: chunk.usage.completion_tokens ?? null,
      };
    }
  }

  return { text, usage, finishReason };
}

/** Non-streaming variant for the eval script: same request shape, whole text back. */
export async function completeAssistant(params: Omit<AssistantStreamParams, 'onToken'>): Promise<AssistantStreamResult> {
  return streamAssistantCompletion({ ...params, onToken: () => {} });
}

export function describeOpenAiError(e: unknown): { status: number | null; message: string; body: unknown } {
  const err = e as { status?: number; message?: string; error?: unknown };
  return { status: err.status ?? null, message: err.message ?? String(e), body: err.error ?? null };
}
