'use client';

/**
 * "What needs you" (UX spec §2 item 3 and the Collective area's overview; W6).
 *
 * A short list, hidden when empty, of only what this venue can act on, each row with one control
 * that goes straight to the fix. The same component for a host and for a member: the rows differ,
 * the shape does not, so nobody has to learn the page twice.
 */
import Link from 'next/link';
import { Button } from '@/components/ui/primitives/Button';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveTodo, CollectiveTodoAction } from '@/lib/linked-accounts/replicas/collective-todos';

export interface CollectiveTodoStripProps {
  todos: CollectiveTodo[];
  /** Open the service that needs calendars chosen. */
  onOpenService?: (serviceId: string) => void;
  /** Bring one venue up to date again (the collective's one Retry). */
  onRetry?: (venueId: string) => void;
}

export function CollectiveTodoStrip({ todos, onOpenService, onRetry }: CollectiveTodoStripProps) {
  if (todos.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">{collectiveCopy('ov.todo.heading')}</h2>
      <ul className="mt-2 space-y-1.5">
        {todos.map((todo) => (
          <li key={todo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-950/90">
            <span>{todo.text}</span>
            {todo.action ? <TodoAction action={todo.action} onOpenService={onOpenService} onRetry={onRetry} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodoAction({
  action,
  onOpenService,
  onRetry,
}: {
  action: CollectiveTodoAction;
  onOpenService?: (serviceId: string) => void;
  onRetry?: (venueId: string) => void;
}) {
  if (action.kind === 'payments') {
    return (
      <Link href="/dashboard/settings?tab=payments" className="font-medium text-brand-700 underline underline-offset-2">
        {action.label}
      </Link>
    );
  }
  if (action.kind === 'forms') {
    return (
      <Link
        href="/dashboard/settings?tab=compliance"
        className="font-medium text-brand-700 underline underline-offset-2"
      >
        {action.label}
      </Link>
    );
  }
  if (action.kind === 'service' && onOpenService) {
    return (
      <Button type="button" variant="link" size="sm" onClick={() => onOpenService(action.serviceId)}>
        {action.label}
      </Button>
    );
  }
  if (action.kind === 'retry' && onRetry) {
    return (
      <Button type="button" variant="link" size="sm" onClick={() => onRetry(action.venueId)}>
        {action.label}
      </Button>
    );
  }
  // 'venue_calendars' has no home of its own yet: the grid (contract 13) is where a host chooses
  // one venue's calendars across every service, so the row says what to do without a shortcut.
  return null;
}
