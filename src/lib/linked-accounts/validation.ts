/** Zod schemas shared by the Linked Accounts API routes. */

import { z } from 'zod';

export const grantSchema = z.object({
  calendar: z.enum(['none', 'time_only', 'full_details']),
  pii: z.boolean(),
  act: z.enum(['none', 'edit_existing', 'create_edit_cancel']),
});

export const grantPairSchema = z.object({
  /** What my venue exposes to the other venue. */
  mine: grantSchema,
  /** What the other venue exposes to my venue. */
  theirs: grantSchema,
});

export const createLinkSchema = z.object({
  targetSlug: z.string().min(1).max(120),
  requestMessage: z.string().max(1000).optional(),
  grants: grantPairSchema,
});

export const respondLinkSchema = z.object({
  action: z.enum([
    'accept',
    'accept_with_changes',
    'reject',
    'cancel',
    'propose_change',
    'accept_change',
    'reject_change',
    'cancel_change',
  ]),
  grants: grantPairSchema.optional(),
});

export const reduceLinkSchema = z.object({
  /** New (reduced) grant my venue exposes to the other venue. */
  grant: grantSchema,
});

export type GrantInput = z.infer<typeof grantSchema>;
export type GrantPairInput = z.infer<typeof grantPairSchema>;

// ---- Cross-venue booking mutation ------------------------------------------

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export const linkedBookingChangeSchema = z.object({
  bookingId: z.string().uuid(),
  changes: z
    .object({
      booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      booking_time: z.string().regex(TIME_RE).optional(),
      booking_end_time: z.string().regex(TIME_RE).optional(),
      practitioner_id: z.string().uuid().nullable().optional(),
      appointment_service_id: z.string().uuid().nullable().optional(),
      status: z
        .enum(['Pending', 'Booked', 'Confirmed', 'Cancelled', 'No-Show', 'Completed', 'Seated'])
        .optional(),
      special_requests: z.string().max(2000).nullable().optional(),
      dietary_notes: z.string().max(2000).nullable().optional(),
    })
    .refine((c) => Object.keys(c).length > 0, { message: 'No changes supplied.' }),
});

// ---- Venue collectives (Phase 2) -------------------------------------------

export const collectiveSlugSchema = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens.');

export const collectiveBrandingSchema = z.object({
  logo_url: z.string().url().max(500).nullable().optional(),
  primary_colour: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  description: z.string().max(600).nullable().optional(),
});

export const createCollectiveSchema = z.object({
  name: z.string().min(2).max(120),
  slug: collectiveSlugSchema,
  branding: collectiveBrandingSchema.optional(),
  serviceGrouping: z.enum(['by_practitioner', 'by_service_type']).optional(),
  allowAnyPractitioner: z.boolean().optional(),
  inviteVenueIds: z.array(z.string().uuid()).min(1).max(20),
});

export const updateCollectiveSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  branding: collectiveBrandingSchema.optional(),
  serviceGrouping: z.enum(['by_practitioner', 'by_service_type']).optional(),
  allowAnyPractitioner: z.boolean().optional(),
});

export const collectiveMemberActionSchema = z.object({
  action: z.enum([
    'invite',
    'accept',
    'decline',
    'leave',
    'remove',
    'configure',
    'transfer_host',
  ]),
  /** invite / remove: the venue being invited or removed. */
  venueId: z.string().uuid().optional(),
  /** configure / accept: member display settings. */
  visiblePractitionerIds: z.array(z.string().uuid()).optional(),
  visibleServiceIds: z.array(z.string().uuid()).optional(),
  allowAnyPractitionerSubstitution: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
});
