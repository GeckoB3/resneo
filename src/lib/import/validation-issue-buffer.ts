import type { SupabaseClient } from '@supabase/supabase-js';

/** Default batch size for `import_validation_issues` inserts (PostgREST payload limits). */
export const VALIDATION_ISSUES_INSERT_CHUNK = 500;

export interface ImportValidationIssueInsert {
  session_id: string;
  file_id: string;
  row_number: number;
  severity: 'error' | 'warning';
  issue_type: string;
  column_name: string | null;
  raw_value: string | null;
  message: string;
}

/** Buffers validation issues and inserts them in chunks to reduce DB round-trips. */
export class ValidationIssueBuffer {
  private readonly pending: ImportValidationIssueInsert[] = [];

  constructor(
    private readonly admin: SupabaseClient,
    private readonly chunkSize: number = VALIDATION_ISSUES_INSERT_CHUNK,
  ) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(issue: ImportValidationIssueInsert): void {
    this.pending.push(issue);
  }

  /** Split `rows` into chunks of at most `chunkSize` (for tests and reuse). */
  static chunk<T>(rows: T[], chunkSize: number): T[][] {
    if (chunkSize <= 0) throw new Error('chunkSize must be positive');
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      out.push(rows.slice(i, i + chunkSize));
    }
    return out;
  }

  private async insertChunk(chunk: ImportValidationIssueInsert[]): Promise<void> {
    if (chunk.length === 0) return;
    const { error } = await this.admin.from('import_validation_issues').insert(chunk);
    if (error) throw new Error(error.message);
  }

  /** Flush if buffer has at least `chunkSize` rows. */
  async flushIfFull(): Promise<void> {
    while (this.pending.length >= this.chunkSize) {
      const chunk = this.pending.splice(0, this.chunkSize);
      await this.insertChunk(chunk);
    }
  }

  /** Insert all remaining rows. */
  async flushAll(): Promise<void> {
    while (this.pending.length > 0) {
      const chunk = this.pending.splice(0, this.chunkSize);
      await this.insertChunk(chunk);
    }
  }

  /** Enqueue one issue and flush when the buffer reaches chunk size. */
  async add(issue: ImportValidationIssueInsert): Promise<void> {
    this.enqueue(issue);
    await this.flushIfFull();
  }
}
