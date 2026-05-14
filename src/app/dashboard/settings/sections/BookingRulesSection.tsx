'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback, useMemo } from 'react';
import type { VenueSettings, BookingRulesSettings } from '../types';
import { useNumericField } from '@/hooks/useNumericField';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { readResponseJson } from '@/lib/http/read-response-json';

const restaurantSchema = z.object({
  min_party_size: z.number().int().min(1).max(20),
  max_party_size: z.number().int().min(1).max(50),
  max_advance_booking_days: z.number().int().min(1).max(365),
  min_notice_hours: z.number().int().min(0).max(168),
});

type RestaurantForm = z.infer<typeof restaurantSchema>;

const defaultRules: BookingRulesSettings = {
  min_party_size: 1,
  max_party_size: 20,
  max_advance_booking_days: 90,
  min_notice_hours: 1,
  cancellation_notice_hours: 48,
  allow_same_day_booking: true,
};

interface BookingRulesSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  bookingModel?: string;
}

export function BookingRulesSection({
  venue,
  onUpdate,
  isAdmin,
  bookingModel = 'table_reservation',
}: BookingRulesSectionProps) {
  const isAppointment = isUnifiedSchedulingVenue(bookingModel);
  const rules = useMemo(() => venue.booking_rules ?? defaultRules, [venue.booking_rules]);
  const { integerProps } = useNumericField();
  const int = integerProps();

  const restaurantForm = useForm<RestaurantForm>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: {
      min_party_size: rules.min_party_size,
      max_party_size: rules.max_party_size,
      max_advance_booking_days: rules.max_advance_booking_days,
      min_notice_hours: rules.min_notice_hours,
    },
  });

  const onRestaurantSubmit = useCallback(async (data: RestaurantForm) => {
    const res = await fetch('/api/venue/booking-rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rules, ...data }),
    });
    const body = await readResponseJson<{ error?: string; booking_rules?: BookingRulesSettings }>(res);
    if (!res.ok) {
      throw new Error(body.error ?? 'Failed to save');
    }
    if (!body.booking_rules) {
      throw new Error('Failed to save');
    }
    onUpdate({ booking_rules: body.booking_rules });
  }, [onUpdate, rules]);

  if (isAppointment) {
    return null;
  }

  const { register, handleSubmit, formState: { errors, isSubmitting } } = restaurantForm;
  return (
    <SectionCard elevated>
      <SectionCard.Header eyebrow="Bookings" title="Booking rules" />
      <SectionCard.Body>
      <form onSubmit={handleSubmit(onRestaurantSubmit)} className="max-w-md space-y-4">
        <div>
          <label htmlFor="min_party_size" className="block text-sm font-medium text-neutral-700 mb-1">Minimum party size</label>
          <input id="min_party_size" {...int.inputProps} min={1} max={20} {...register('min_party_size', int.registerOptions)} disabled={!isAdmin} className="w-full rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50" />
          {errors.min_party_size && <p className="mt-1 text-sm text-red-600">{errors.min_party_size.message}</p>}
        </div>
        <div>
          <label htmlFor="max_party_size" className="block text-sm font-medium text-neutral-700 mb-1">Maximum party size</label>
          <input id="max_party_size" {...int.inputProps} min={1} max={50} {...register('max_party_size', int.registerOptions)} disabled={!isAdmin} className="w-full rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50" />
          {errors.max_party_size && <p className="mt-1 text-sm text-red-600">{errors.max_party_size.message}</p>}
        </div>
        <div>
          <label htmlFor="max_advance_booking_days" className="block text-sm font-medium text-neutral-700 mb-1">Maximum advance booking (days)</label>
          <input id="max_advance_booking_days" {...int.inputProps} min={1} max={365} {...register('max_advance_booking_days', int.registerOptions)} disabled={!isAdmin} className="w-full rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50" />
          {errors.max_advance_booking_days && <p className="mt-1 text-sm text-red-600">{errors.max_advance_booking_days.message}</p>}
        </div>
        <div>
          <label htmlFor="min_notice_hours" className="block text-sm font-medium text-neutral-700 mb-1">Minimum notice (hours before booking)</label>
          <input id="min_notice_hours" {...int.inputProps} min={0} max={168} {...register('min_notice_hours', int.registerOptions)} disabled={!isAdmin} className="w-full rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-50" />
          {errors.min_notice_hours && <p className="mt-1 text-sm text-red-600">{errors.min_notice_hours.message}</p>}
        </div>
        {isAdmin && (
          <button type="submit" disabled={isSubmitting} className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {isSubmitting ? 'Saving…' : 'Save booking rules'}
          </button>
        )}
      </form>
      </SectionCard.Body>
    </SectionCard>
  );
}
