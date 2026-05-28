import { z } from 'zod';

/**
 * One add-on option inside a group (e.g. "Argan oil conditioner +£5 +0min").
 * Used both for creating fresh options and editing existing rows; the optional
 * `id` lets the dashboard preserve a stable form key.
 */
export const addonInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  additional_price_pence: z.number().int().nonnegative(),
  additional_duration_minutes: z.number().int().min(0).max(240),
  cost_to_business_pence: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().optional().default(true),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

export type AddonInput = z.infer<typeof addonInputSchema>;

/**
 * One group (with embedded options). Save = delete + reinsert options, matching
 * the variant pattern. Snapshot rows on `booking_addons` keep historical pricing
 * intact when an option id changes on re-save.
 */
export const addonGroupInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    prompt_to_client: z.string().max(240).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    selection_type: z.enum(['single', 'multi']),
    min_select: z.number().int().min(0).optional().default(0),
    max_select: z.number().int().min(0).nullable().optional(),
    hidden_from_online: z.boolean().optional().default(false),
    is_active: z.boolean().optional().default(true),
    sort_order: z.number().int().nonnegative().optional().default(0),
    addons: z.array(addonInputSchema).min(1, 'At least one option is required').max(40),
  })
  .superRefine((data, ctx) => {
    if (data.selection_type === 'single') {
      if (data.max_select != null && data.max_select > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Single-select groups must have max_select <= 1.',
          path: ['max_select'],
        });
      }
      if (data.min_select != null && data.min_select > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Single-select groups must have min_select of 0 or 1.',
          path: ['min_select'],
        });
      }
    }
    if (data.max_select != null && data.max_select < data.min_select) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_select must be greater than or equal to min_select.',
        path: ['max_select'],
      });
    }
  });

export type AddonGroupInput = z.infer<typeof addonGroupInputSchema>;

/** One add-on selection in a booking-create / availability request. */
export const bookingAddonSelectionSchema = z.object({
  addon_id: z.string().uuid(),
  booking_segment_index: z.number().int().nonnegative().optional(),
});

export type BookingAddonSelectionInputZ = z.infer<typeof bookingAddonSelectionSchema>;

/** Array of selections. Empty array means no add-ons chosen. */
export const bookingAddonSelectionArraySchema = z.array(bookingAddonSelectionSchema).max(50);

/**
 * Service ↔ addon-group link rows passed to POST/PATCH /api/venue/appointment-services.
 * `addon_group_id` may either be an id of an existing group, or omitted; the dashboard
 * passes the existing group id when linking.
 */
export const addonGroupLinkInputSchema = z.object({
  addon_group_id: z.string().uuid(),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

export type AddonGroupLinkInput = z.infer<typeof addonGroupLinkInputSchema>;

export const addonGroupLinksArraySchema = z.array(addonGroupLinkInputSchema).max(40);
