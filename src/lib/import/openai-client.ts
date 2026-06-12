/**
 * Shared OpenAI plumbing for the import tool's AI stages.
 *
 * - GPT-5-family models reject non-default `temperature`, so we never send one
 *   (the old code sent temperature: 0, which 400'd and made AI mapping silently
 *   unavailable).
 * - All calls use strict structured outputs (`json_schema`) so responses always
 *   match the expected shape — no defensive re-parsing at call sites.
 * - The SDK client is configured with a timeout and retries; errors are logged
 *   with the response body so failures are diagnosable from logs.
 */

import OpenAI from 'openai';

export const IMPORT_AI_TIMEOUT_MS = 45_000;
export const IMPORT_AI_MAX_RETRIES = 2;

export function importAiModel(): string {
  return process.env.OPENAI_IMPORT_MODEL?.trim() || 'gpt-5.4-nano';
}

/**
 * Model for the reshape stage. Reshaping a messy report into a clean table needs
 * more reasoning than column mapping (forward-filling section headers, inferring
 * a missing first date), so it defaults to a stronger model than the nano mapper.
 */
export function importReshapeModel(): string {
  return (
    process.env.OPENAI_IMPORT_RESHAPE_MODEL?.trim() ||
    process.env.OPENAI_IMPORT_MODEL?.trim() ||
    'gpt-5.4-mini'
  );
}

export function importAiAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Run one structured-output completion. Returns the parsed JSON object, or null
 * when the API key is missing or the call ultimately fails (callers treat null
 * as "AI unavailable" and fall back to deterministic behaviour).
 */
export async function runImportAiJson<T>(params: {
  /** Used in logs, e.g. 'ai-map-columns'. */
  callSite: string;
  system: string;
  user: string;
  /** JSON Schema (strict mode: additionalProperties false, all keys required). */
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Override the default mapping model (e.g. the reshape stage uses a stronger one). */
  model?: string;
}): Promise<{ data: T; model: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[import ${params.callSite}] OPENAI_API_KEY not set`);
    return null;
  }
  const model = params.model?.trim() || importAiModel();
  const openai = new OpenAI({
    apiKey,
    timeout: IMPORT_AI_TIMEOUT_MS,
    maxRetries: IMPORT_AI_MAX_RETRIES,
  });

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
      ...(params.maxOutputTokens ? { max_completion_tokens: params.maxOutputTokens } : {}),
    });

    const choice = completion.choices[0];
    const raw = choice?.message?.content;
    if (!raw) {
      console.error(`[import ${params.callSite}] empty completion`, {
        model,
        finish_reason: choice?.finish_reason ?? null,
        refusal: choice?.message?.refusal ?? null,
      });
      return null;
    }
    return { data: JSON.parse(raw) as T, model };
  } catch (e) {
    const err = e as { status?: number; message?: string; error?: unknown };
    console.error(`[import ${params.callSite}] OpenAI error`, {
      model,
      status: err.status ?? null,
      message: err.message ?? String(e),
      body: err.error ?? null,
    });
    return null;
  }
}
