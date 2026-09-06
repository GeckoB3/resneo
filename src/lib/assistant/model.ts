/**
 * The one place the Ask ResNeo model name is resolved (Docs/help-assistant-plan.md, 3.7,
 * decision D6). `OPENAI_ASSISTANT_MODEL` pins the assistant on its own; otherwise it follows
 * `OPENAI_IMPORT_MODEL`, the Vercel variable that already names the production model, so
 * changing that one variable changes the assistant too. The code never hard-codes, ships or
 * compares against the model name anywhere else.
 */
export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.6-luna';

export function assistantModel(): string {
  return (
    process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
    process.env.OPENAI_IMPORT_MODEL?.trim() ||
    DEFAULT_ASSISTANT_MODEL
  );
}
