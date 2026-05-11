'use client';

import { useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { AvailableSlot, GuestDetails } from './types';
import type { CountryCode } from 'libphonenumber-js';
import { normalizeToE164 } from '@/lib/phone/e164';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import {
  cancellationDeadlineHoursBefore,
  classifyGroupDepositRefunds,
  formatRefundDeadlineDisplay,
  isDepositRefundAvailableAt,
} from '@/lib/booking/cancellation-deadline';
import { formatOnlinePaidRefundPolicyLine } from '@/lib/booking/public-deposit-refund-policy';
import type { ClassPaymentRequirement } from '@/types/booking-models';

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `${SHORT_WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

function buildDetailsSchemaWithTerms(phoneCc: CountryCode) {
  return z
    .object({
      first_name: z.string().min(1, 'First name is required').max(100),
      last_name: z.string().min(1, 'Surname is required').max(100),
      email: z.string().min(1, 'Email is required').email('Valid email required'),
      phone: z
        .string()
        .min(1, 'Phone is required')
        .max(24)
        .refine((v) => normalizeToE164(v, phoneCc) !== null, 'Enter a valid mobile number'),
      dietary_notes: z.string().max(1000).optional(),
      occasion: z.string().max(200).optional(),
      /** Model B: shown as “Comments or requests”, stored as booking dietary_notes */
      comments_requests: z.string().max(1000).optional(),
    })
    .and(
      z.object({
        marketingConsent: z.boolean(),
        acceptTerms: z.boolean().refine((v) => v === true, { message: 'You must accept the booking terms' }),
      }),
    );
}

/** Staff dashboard: name + phone required; email optional when provided. No guest terms checkbox. */
function buildDetailsSchemaStaff(phoneCc: CountryCode) {
  return z.object({
    first_name: z.string().max(100),
    last_name: z.string().max(100),
    email: z.union([z.literal(''), z.string().email('Valid email required')]),
    phone: z
      .string()
      .min(1, 'Phone is required')
      .max(24)
      .refine((v) => normalizeToE164(v, phoneCc) !== null, 'Enter a valid mobile number'),
    dietary_notes: z.string().max(1000).optional(),
    occasion: z.string().max(200).optional(),
    comments_requests: z.string().max(1000).optional(),
    acceptTerms: z.boolean().optional(),
  });
}

/** Walk-in staff: no required contact fields; name defaults to "Walk In" on submit when blank. */
function buildDetailsSchemaStaffWalkIn(phoneCc: CountryCode) {
  return z.object({
    first_name: z.string().max(100),
    last_name: z.string().max(100),
    email: z.union([z.literal(''), z.string().email('Valid email required')]),
    phone: z
      .string()
      .max(24)
      .refine((v) => !v.trim() || normalizeToE164(v, phoneCc) !== null, 'Enter a valid mobile number or leave blank'),
    dietary_notes: z.string().max(1000).optional(),
    occasion: z.string().max(200).optional(),
    comments_requests: z.string().max(1000).optional(),
    acceptTerms: z.boolean().optional(),
  });
}

type FormDataWithTerms = z.infer<ReturnType<typeof buildDetailsSchemaWithTerms>>;
type FormDataStaff = z.infer<ReturnType<typeof buildDetailsSchemaStaff>>;
type FormDataStaffWalkIn = z.infer<ReturnType<typeof buildDetailsSchemaStaffWalkIn>>;

interface DetailsStepProps {
  slot: AvailableSlot;
  date: string;
  partySize: number;
  onSubmit: (details: GuestDetails) => void;
  onBack: () => void;
  requiresDeposit?: boolean;
  depositPerPerson?: number;
  variant?: 'restaurant' | 'appointment' | 'class';
  appointmentDepositPence?: number | null;
  currencySymbol?: string;
  refundNoticeHours?: number;
  /** Group appointments: one slot per person so refund messaging matches each start time. */
  multiAppointmentSlots?: Array<{ date: string; time: string }>;
  /** Defaults country code (+44 for GB) from venue currency; falls back to GB. */
  phoneDefaultCountry?: CountryCode;
  /** Resource / class: wording for the amount collected online before the appointment. */
  appointmentChargeLabel?: 'deposit' | 'full_payment';
  /** Priced booking with pay-at-venue mode: show expected balance due on site. */
  payAtVenueBalancePence?: number | null;
  /** When set with payAtVenueBalancePence, explains why no online charge (e.g. resource pay at venue). */
  payAtVenuePaymentRequirement?: ClassPaymentRequirement;
  /** Staff dashboard: email optional; guest terms checkbox omitted. */
  audience?: 'public' | 'staff' | 'staff_walk_in';
}

export function DetailsStep({
  slot,
  date,
  partySize,
  onSubmit,
  onBack,
  requiresDeposit,
  depositPerPerson,
  variant = 'restaurant',
  appointmentDepositPence = null,
  currencySymbol = '£',
  refundNoticeHours = 48,
  multiAppointmentSlots,
  phoneDefaultCountry = 'GB',
  appointmentChargeLabel = 'deposit',
  payAtVenueBalancePence,
  payAtVenuePaymentRequirement,
  audience = 'public',
}: DetailsStepProps) {
  const isStaff = audience === 'staff';
  const isStaffWalkIn = audience === 'staff_walk_in';
  const detailsSchemaWithTerms = useMemo(
    () => buildDetailsSchemaWithTerms(phoneDefaultCountry),
    [phoneDefaultCountry],
  );
  const detailsSchemaStaff = useMemo(
    () => buildDetailsSchemaStaff(phoneDefaultCountry),
    [phoneDefaultCountry],
  );
  const detailsSchemaStaffWalkIn = useMemo(
    () => buildDetailsSchemaStaffWalkIn(phoneDefaultCountry),
    [phoneDefaultCountry],
  );
  const activeSchema = isStaffWalkIn ? detailsSchemaStaffWalkIn : isStaff ? detailsSchemaStaff : detailsSchemaWithTerms;
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<
    FormDataWithTerms | FormDataStaff | FormDataStaffWalkIn
  >({
    resolver: zodResolver(activeSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      dietary_notes: '',
      occasion: '',
      comments_requests: '',
      acceptTerms: false,
      marketingConsent: true,
    },
  });

  const dateStr = formatDate(date);
  const isAppointment = variant === 'appointment';
  const isClass = variant === 'class';
  const useAppointmentFields = isAppointment || isClass;
  const depositPence = appointmentDepositPence ?? 0;
  const hasDeposit = useAppointmentFields && depositPence > 0;
  const payAtVenuePence = payAtVenueBalancePence ?? 0;
  const showPayAtVenue =
    useAppointmentFields &&
    payAtVenuePaymentRequirement === 'none' &&
    payAtVenuePence > 0 &&
    !hasDeposit;

  const refundClassification = (() => {
    if (!hasDeposit || !slot.start_time) return null;
    const slots =
      multiAppointmentSlots && multiAppointmentSlots.length > 0
        ? multiAppointmentSlots
        : [{ date, time: slot.start_time }];
    const groupClass = classifyGroupDepositRefunds(slots, refundNoticeHours);
    const singleIso = cancellationDeadlineHoursBefore(date, slot.start_time, refundNoticeHours);
    const singleRefundable = isDepositRefundAvailableAt(singleIso);
    return { groupClass, singleIso, singleRefundable, slots };
  })();

  const refundDeadlineLabel =
    hasDeposit && slot.start_time && refundClassification
      ? formatRefundDeadlineDisplay(date, slot.start_time, refundNoticeHours)
      : null;

  return (
    <div className="space-y-5">
      {/* Booking summary card */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600" aria-label="Go back">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{dateStr}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{slot.start_time.slice(0, 5)}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{partySize} {partySize === 1 ? 'guest' : 'guests'}</span>
        </div>
      </div>

      {useAppointmentFields && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            hasDeposit ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
              <p className="text-sm font-semibold text-slate-900">Cancellation policy</p>
          {!hasDeposit && !showPayAtVenue && <p className="mt-1 text-sm text-slate-600">Cancel for free anytime</p>}
          {showPayAtVenue && (
            <p className="mt-1 text-sm text-slate-600">
              Payment of {currencySymbol}
              {(payAtVenuePence / 100).toFixed(2)} is due at the venue (no online payment for this booking).
            </p>
          )}
          {hasDeposit && (
            <div className="mt-2 space-y-2">
              <p className="text-sm font-medium text-amber-900">
                {appointmentChargeLabel === 'full_payment' ? 'Full payment' : 'Deposit'}: {currencySymbol}
                {(depositPence / 100).toFixed(2)}
                {partySize > 1
                  ? ` (total for ${partySize} ${isClass ? 'spots' : 'appointments'})`
                  : ''}
              </p>
              {partySize <= 1 && refundDeadlineLabel && refundClassification && (
                <>
                  {refundClassification.singleRefundable ? (
                    <p className="text-sm text-amber-900">
                      Full refund if you cancel by <span className="font-semibold">{refundDeadlineLabel}</span> ({refundNoticeHours}h before start).
                    </p>
                  ) : (
                    <p className="text-sm text-amber-900">
                      Refund cut-off was <span className="font-semibold">{refundDeadlineLabel}</span> ({refundNoticeHours}h before start). That time has passed -
                      this {appointmentChargeLabel === 'full_payment' ? 'payment' : 'deposit'} is not refundable if you cancel.
                    </p>
                  )}
                </>
              )}
              {partySize > 1 && refundClassification && (
                <>
                  {refundClassification.groupClass === 'all_refundable' && (
                    <p className="text-sm text-amber-900">
                      Full refund of each share if you cancel ≥{refundNoticeHours}h before that appointment&apos;s start.
                    </p>
                  )}
                  {refundClassification.groupClass === 'none_refundable' && (
                    <p className="text-sm text-amber-900">
                      Refund cut-off has passed for at least one appointment - the matching share of this deposit isn&apos;t refundable if you cancel.
                    </p>
                  )}
                  {refundClassification.groupClass === 'mixed' && (
                    <p className="text-sm text-amber-900">
                      Rules apply per appointment (≥{refundNoticeHours}h before start). Cut-off has passed for some slots - those shares aren&apos;t refundable.
                    </p>
                  )}
                </>
              )}
              <p className="text-xs text-amber-800/90">No refund after the deadline above. No-shows aren&apos;t refunded.</p>
            </div>
          )}
        </div>
      )}

      {!isAppointment && requiresDeposit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800">
                Deposit of &pound;{depositPerPerson?.toFixed(2) ?? '5.00'} per person required
              </p>
              <p className="text-xs text-amber-700">{formatOnlinePaidRefundPolicyLine(refundNoticeHours)}</p>
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit((d) => {
          const phoneRaw = 'phone' in d ? d.phone : '';
          const e164 = phoneRaw.trim() ? normalizeToE164(phoneRaw, phoneDefaultCountry) : null;
          const fnRaw = 'first_name' in d ? String(d.first_name ?? '').trim() : '';
          const lnRaw = 'last_name' in d ? String(d.last_name ?? '').trim() : '';
          onSubmit({
            first_name: fnRaw,
            last_name: lnRaw,
            email: d.email || '',
            phone: e164 ?? (phoneRaw.trim() ? phoneRaw : ''),
            dietary_notes: useAppointmentFields
              ? (d.comments_requests?.trim() ? d.comments_requests.trim() : undefined)
              : (d.dietary_notes?.trim() ? d.dietary_notes.trim() : undefined),
            occasion: useAppointmentFields ? undefined : (d.occasion?.trim() ? d.occasion.trim() : undefined),
            ...(audience === 'public' && 'marketingConsent' in d
              ? { marketing_consent: Boolean(d.marketingConsent) }
              : {}),
          });
        })}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="First name"
            required={audience === 'public'}
            error={errors.first_name?.message}
          >
            <input
              {...register('first_name')}
              autoComplete="given-name"
              className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="First name"
            />
          </FormField>
          <FormField label="Surname" required={audience === 'public'} error={errors.last_name?.message}>
            <input
              {...register('last_name')}
              autoComplete="family-name"
              className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="Surname"
            />
          </FormField>
        </div>

        <FormField label="Email" required={audience === 'public'} error={errors.email?.message}>
          <input
            type="email"
            {...register('email')}
            className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="you@example.com"
          />
        </FormField>

        <FormField label="Phone" required={audience !== 'staff_walk_in'}>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneWithCountryField
                id="details-phone"
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                defaultCountry={phoneDefaultCountry}
                error={errors.phone?.message}
                inputClassName="min-h-[44px] w-full min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            )}
          />
        </FormField>

        {!useAppointmentFields && (
          <>
            <FormField label="Dietary notes" error={errors.dietary_notes?.message}>
              <textarea {...register('dietary_notes')} rows={2} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500" placeholder="Allergies, vegetarian, etc." />
            </FormField>

            <FormField label="Occasion" error={errors.occasion?.message}>
              <input {...register('occasion')} className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500" placeholder="e.g. Birthday, Anniversary" />
            </FormField>
          </>
        )}

        {isAppointment && (
          <FormField label="Comments or requests" error={errors.comments_requests?.message}>
            <textarea
              {...register('comments_requests')}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="Anything we should know (access needs, preferences, running late, etc.)"
            />
          </FormField>
        )}

        {isClass && (
          <FormField label="Notes" error={errors.comments_requests?.message}>
            <textarea
              {...register('comments_requests')}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="Any requirements, injuries, or things we should know?"
            />
          </FormField>
        )}

        {audience === 'public' && (
          <>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3">
              <input type="checkbox" {...register('marketingConsent')} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-600">
                Sign me up to receive offers and news from this business by email.
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3">
              <input type="checkbox" {...register('acceptTerms')} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-600">
                I accept the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">Website Terms of Use</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">Privacy Policy</a>.
              </span>
            </label>
            {errors.acceptTerms && <p className="text-xs text-red-600">{errors.acceptTerms.message}</p>}
          </>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[48px] w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {isSubmitting
            ? 'Processing...'
            : (isAppointment || isClass) && hasDeposit
              ? 'Continue to payment'
              : !useAppointmentFields && requiresDeposit
                ? 'Continue to Payment'
                : 'Confirm Booking'}
        </button>
      </form>
    </div>
  );
}

function FormField({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
