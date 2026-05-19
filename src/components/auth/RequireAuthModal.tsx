'use client';

import { LoginForm } from '@/app/login/login-form';
import { Dialog } from '@/components/ui/primitives/Dialog';

type RequireAuthModalProps = {
  open: boolean;
  /** Path-only redirect after login (e.g. `/book/foo?tab=classes`). */
  redirectTo: string;
  title?: string;
  onClose?: () => void;
};

/**
 * Inline auth gate: password + magic link (same UX as `/login`).
 * Use when an unauthenticated user attempts a Section 7.3 action from a public page.
 */
export function RequireAuthModal({
  open,
  redirectTo,
  title = 'Sign in to continue',
  onClose,
}: RequireAuthModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      title={title}
      description="Use your email and password, or request a magic link. After signing in you'll return to what you were doing."
      size="md"
      showClose={Boolean(onClose)}
    >
      <LoginForm redirectTo={redirectTo} />
    </Dialog>
  );
}
