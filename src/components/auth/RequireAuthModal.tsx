'use client';

import { LoginForm, type LoginFormVariant } from '@/app/login/login-form';
import { Dialog } from '@/components/ui/primitives/Dialog';

type RequireAuthModalProps = {
  open: boolean;
  /** Path-only redirect after login (e.g. `/book/foo?tab=classes`). */
  redirectTo: string;
  title?: string;
  description?: string;
  /** Booking gate: email-link-first copy for new customers. */
  variant?: LoginFormVariant;
  onClose?: () => void;
};

/**
 * Inline auth gate: password + magic link (same UX as `/login`).
 * Use when an unauthenticated user attempts a Section 7.3 action from a public page.
 */
export function RequireAuthModal({
  open,
  redirectTo,
  title,
  description,
  variant = 'default',
  onClose,
}: RequireAuthModalProps) {
  const isBooking = variant === 'booking';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      title={title ?? (isBooking ? 'Continue with ResNeo' : 'Sign in to continue')}
      description={
        description ??
        (isBooking
          ? undefined
          : "Use your email and password, or request a magic link. After signing in you'll return to what you were doing.")
      }
      size="md"
      showClose={Boolean(onClose)}
    >
      <LoginForm redirectTo={redirectTo} variant={variant} />
    </Dialog>
  );
}
