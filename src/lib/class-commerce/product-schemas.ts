import { z } from 'zod';

/** Membership billing + allowance rules stored in `class_membership_products.rules` (jsonb). */
export const classMembershipRulesSchema = z
  .object({
    unlimited: z.boolean().optional(),
    allowance_per_period: z.number().int().min(0).max(10000).optional().nullable(),
    rollover: z.boolean().optional(),
    rollover_limit: z.number().int().min(0).max(10000).optional().nullable(),
    discount_percent: z.number().min(0).max(100).optional().nullable(),
    eligible_class_type_ids: z.array(z.string().uuid()).max(500).optional().nullable(),
    allow_recurring: z.boolean().optional(),
    members_only_priority_hours: z.number().min(0).max(168).optional().nullable(),
    booking_window_days: z.number().int().min(0).max(365).optional().nullable(),
    recurring_interval: z.enum(['week', 'month', 'year']).optional(),
    recurring_interval_count: z.number().int().min(1).max(12).optional(),
  })
  .partial();

export type ClassMembershipRules = z.infer<typeof classMembershipRulesSchema>;

export const classCreditProductBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  credits_count: z.number().int().min(1).max(1000),
  price_pence: z.number().int().min(0),
  currency: z.string().length(3).optional().default('gbp'),
  validity_days: z.number().int().min(1).max(3650).optional().nullable(),
  eligible_class_type_ids: z.array(z.string().uuid()).max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export const classCreditProductPatchSchema = classCreditProductBodySchema.partial();

const courseFields = {
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  price_pence: z.number().int().min(0),
  currency: z.string().length(3).optional().default('gbp'),
  max_enrollments: z.number().int().min(1).optional().nullable(),
  opens_at: z.string().max(80).optional().nullable(),
  closes_at: z.string().max(80).optional().nullable(),
  session_instance_ids: z.array(z.string().uuid()).max(500).default([]),
  active: z.boolean().optional(),
  /** Phase 2 §5.3 — refund window in days before the first session. NULL = non-refundable. */
  cancellation_window_days: z.number().int().min(0).max(365).optional().nullable(),
};

function refineCourseWindows(
  opens_at: string | null | undefined,
  closes_at: string | null | undefined,
  ctx: z.RefinementCtx,
) {
  if (opens_at && closes_at) {
    const a = Date.parse(opens_at);
    const b = Date.parse(closes_at);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a >= b) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'closes_at must be after opens_at',
        path: ['closes_at'],
      });
    }
  }
}

/** POST create — active courses must list at least one session. */
export const classCourseProductBodySchema = z
  .object(courseFields)
  .superRefine((data, ctx) => {
    refineCourseWindows(data.opens_at, data.closes_at, ctx);
    if (data.active !== false && data.session_instance_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one class session before publishing this course.',
        path: ['session_instance_ids'],
      });
    }
  });

/** PATCH — partial fields; window order validated when both sent. */
export const classCourseProductPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    price_pence: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
    max_enrollments: z.number().int().min(1).optional().nullable(),
    opens_at: z.string().max(80).optional().nullable(),
    closes_at: z.string().max(80).optional().nullable(),
    session_instance_ids: z.array(z.string().uuid()).max(500).optional(),
    active: z.boolean().optional(),
    cancellation_window_days: z.number().int().min(0).max(365).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    refineCourseWindows(data.opens_at, data.closes_at, ctx);
  });

export const classMembershipProductBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  /** Legacy: staff-pasted Stripe Price on connected account. Omit when using recurring_price_pence + interval. */
  stripe_price_id: z.string().min(1).max(200).optional().nullable(),
  stripe_product_id: z.string().min(1).max(200).optional().nullable(),
  currency: z.string().length(3).optional().default('gbp'),
  rules: classMembershipRulesSchema.optional(),
  active: z.boolean().optional(),
  /** When set with venue Stripe Connect, API creates/updates Stripe Product + recurring Price. */
  recurring_price_pence: z.number().int().min(1).max(10_000_000).optional(),
  recurring_interval: z.enum(['week', 'month', 'year']).optional(),
  recurring_interval_count: z.number().int().min(1).max(12).optional().default(1),
});

export const classMembershipProductPatchSchema = classMembershipProductBodySchema.partial();

export function parseMembershipRules(raw: unknown): ClassMembershipRules {
  const parsed = classMembershipRulesSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  return parsed.success ? parsed.data : {};
}
