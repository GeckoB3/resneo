import { z } from 'zod';
import type { VenueFeatureFlags } from '@/lib/feature-flags/types';

export const APPOINTMENT_WAITLIST_MODES = [
  'staff_choose',
  'notify_in_order',
  'notify_all',
] as const;

export type AppointmentWaitlistMode = (typeof APPOINTMENT_WAITLIST_MODES)[number];

export const waitlistConfigSchema = z.object({
  mode: z.enum(APPOINTMENT_WAITLIST_MODES).default('notify_in_order'),
});

export type WaitlistConfig = z.infer<typeof waitlistConfigSchema>;

export const WAITLIST_MODE_LABELS: Record<
  AppointmentWaitlistMode,
  { title: string; description: string }
> = {
  staff_choose: {
    title: 'Staff choose',
    description:
      'When a slot opens, staff see a banner and choose who to offer it to, or use Offer appointment for the first matching guest.',
  },
  notify_in_order: {
    title: 'First in line, notify in order',
    description:
      'The first matching guest is notified by email and SMS. If they do not book within 30 minutes, the next guest is notified. The slot stays open on your booking page throughout.',
  },
  notify_all: {
    title: 'Offer to all',
    description:
      'Every matching guest is notified at once. The slot stays open, and whoever books first gets it.',
  },
};

/** Parse waitlist mode from venue feature flags; defaults to notify_in_order (legacy behaviour). */
export function parseWaitlistConfig(flags: VenueFeatureFlags | null | undefined): WaitlistConfig {
  const parsed = waitlistConfigSchema.safeParse(flags?.waitlist_config ?? {});
  return parsed.success ? parsed.data : { mode: 'notify_in_order' };
}
